import {
  AIMessage,
  BaseMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { PromptType } from '@shannon/common';
import { loadPrompt } from '../config/prompts.js';
import { ExecutionResult, GRAPH_CONFIG, TaskStateInput } from './types.js';

export class Prompt {
  public prompts: Map<PromptType, string>;
  private tools: StructuredTool[];

  constructor(tools: StructuredTool[]) {
    this.prompts = new Map();
    this.tools = tools;
    this.setupPrompts();
  }

  private async setupPrompts(): Promise<void> {
    const promptsName: PromptType[] = ['planning', 'emotion', 'use_tool'];
    for (const name of promptsName) {
      this.prompts.set(name, await loadPrompt(name, 'taskGraph'));
    }
  }

  private getPrompt = (promptName: PromptType): string => {
    const prompt = this.prompts.get(promptName);
    if (!prompt) {
      throw new Error(`prompt not found: ${promptName}`);
    }
    return prompt.replace(/\\n/g, '\n').replace(/\\/g, '').replace(/"/g, "'");
  };

  /**
   * ツール情報を整形して返す
   */
  private getToolsInfo(): string {
    return this.tools
      .map((tool) => {
        // パラメータ情報を整形
        let paramsInfo = '';
        try {
          const schema = tool.schema;
          if (schema && typeof schema === 'object' && '_def' in schema) {
            const def = (schema as any)._def;
            if (def.typeName === 'ZodObject' && def.shape) {
              const params = Object.entries(def.shape()).map(([key, field]: [string, any]) => {
                const desc = field?._def?.description || '';
                const typeName = field?._def?.typeName || 'unknown';
                const isOptional = typeName === 'ZodOptional' || typeName === 'ZodNullable';
                return `  - ${key}${isOptional ? ' (optional)' : ''}: ${desc}`;
              });
              paramsInfo = params.length > 0 ? `\nParameters:\n${params.join('\n')}` : '';
            }
          }
        } catch (e) {
          // パラメータ解析に失敗した場合は空のまま
        }

        return `Tool: ${tool.name}\nDescription: ${tool.description}${paramsInfo}`;
      })
      .join('\n\n');
  }

  /**
   * メッセージを構築
   */
  public getMessages = (
    state: TaskStateInput,
    promptName: PromptType,
    isMemoryZone: boolean = false,
    isToolInfo: boolean = false
  ): BaseMessage[] => {
    const prompt = this.getPrompt(promptName);
    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });

    // 環境情報
    const environmentState = state.environmentState
      ? `environmentState: ${JSON.stringify(state.environmentState, null, 2)
        .replace(/\\n/g, '\n')
        .replace(/\\/g, '')
        .replace(/"/g, "'")}`
      : null;

    const currentTimeMessage = `currentTime: ${currentTime}`;

    // コンテキスト情報（新しいTaskContext形式を優先）
    let contextMessage = '';
    if (state.context) {
      contextMessage = `context: ${JSON.stringify(state.context, null, 2)}`;
    } else if (isMemoryZone && state.memoryZone) {
      contextMessage = `memoryZone: ${state.memoryZone}`;
    }

    // ツール情報
    const toolInfoMessage = isToolInfo
      ? `Available Tools:\n${this.getToolsInfo()}`
      : '';

    // エラー情報の抽出（再試行時）
    let errorMessage = null;
    const retryCount = state.retryCount || 0;
    if (state.messages && state.messages.length > 0) {
      const recentMessages = state.messages.slice(-5);
      const errors: string[] = [];

      for (const msg of recentMessages) {
        if (msg instanceof ToolMessage) {
          const content = String(msg.content);
          if (content.includes('エラー') || content.includes('失敗') || content.includes('スキップ')) {
            errors.push(content);
          }
        }
      }

      if (errors.length > 0) {
        errorMessage = `Previous Errors (Attempt ${retryCount + 1}/${GRAPH_CONFIG.MAX_RETRY_COUNT}):\n${errors.join('\n')}\n\n**IMPORTANT: This is attempt ${retryCount + 1} of ${GRAPH_CONFIG.MAX_RETRY_COUNT}. Try a different approach or report the error to the user.**`;
      }
    }

    const messages = [
      new SystemMessage(prompt),
      state.userMessage
        ? new SystemMessage(`userMessage: ${state.userMessage}`)
        : null,
      new SystemMessage(
        [environmentState, currentTimeMessage, contextMessage]
          .filter(Boolean)
          .join('\n')
      ),
      state.selfState
        ? new SystemMessage(`selfState: ${JSON.stringify(state.selfState)}`)
        : null,
      state.taskTree
        ? new SystemMessage(
          `=== Current Task State ===
goal: ${state.taskTree.goal}
strategy: ${state.taskTree.strategy}
status: ${state.taskTree.status}

=== hierarchicalSubTasks (タスクの全体像) ===
${state.taskTree.hierarchicalSubTasks ? JSON.stringify(state.taskTree.hierarchicalSubTasks, null, 2) : 'null (新規タスク)'}

currentSubTaskId: ${state.taskTree.currentSubTaskId || 'null'}

=== subTasks (後方互換) ===
${state.taskTree.subTasks ? JSON.stringify(state.taskTree.subTasks, null, 2) : 'null'}

=== 重要: サブタスクの更新ルール ===
- completed/error → 絶対に変更しない（結果確定済み）
- in_progress → 基本引き継ぎ、子タスク追加はOK
- pending → 修正・削除OK（まだ実行していないので計画変更可能）
`
        )
        : null,
      errorMessage ? new SystemMessage(errorMessage) : null,
      // === 前回の実行結果 ===
      state.executionResults && state.executionResults.length > 0
        ? new SystemMessage(
          `=== Previous Execution Results ===
${state.executionResults.map((r: ExecutionResult, i: number) =>
            `${i + 1}. ${r.toolName}:
     success: ${r.success}
     result: ${r.message}
     ${r.error ? `error: ${r.error}` : ''}`
          ).join('\n')}

**IMPORTANT: You must use these results to decide the next action. Do NOT repeat the same tool if it already succeeded. Analyze the result and proceed to the next step.**`
        )
        : null,
      state.humanFeedback
        ? new SystemMessage(
          `humanFeedback: ${JSON.stringify(state.humanFeedback)}`
        )
        : null,
      state.selfFeedback
        ? new SystemMessage(
          `selfFeedback: ${JSON.stringify(state.selfFeedback)}`
        )
        : null,
      state.emotion
        ? new SystemMessage(`myEmotion: ${JSON.stringify(state.emotion)}`)
        : null,
      isToolInfo ? new SystemMessage(toolInfoMessage) : null,
      new SystemMessage(`the actionLog is as follows.`),
      // メッセージを変換して追加
      ...(state.messages
        ?.slice(-GRAPH_CONFIG.MAX_RECENT_MESSAGES)
        .flatMap((msg) => {
          // AIMessage(tool_calls付き)は除外
          if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
            return [];
          }
          // ToolMessageはSystemMessageに変換（OpenAI APIの制約を回避）
          if (msg instanceof ToolMessage) {
            return [new SystemMessage(`Tool Result: ${msg.content}`)];
          }
          // その他のメッセージはそのまま
          return [msg];
        }) ?? []),
    ].filter((message): message is BaseMessage => message !== null);

    return messages;
  };
}
