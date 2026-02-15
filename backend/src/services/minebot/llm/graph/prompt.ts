import { AIMessage, BaseMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'; // prompt reload trigger
import { Tool } from '@langchain/core/tools';
import { PromptType } from '@shannon/common';
import { CONFIG } from '../../config/MinebotConfig.js';
import { loadPrompt } from '../config/prompts.js';
import { TaskStateInput } from './types.js';

export class Prompt {
  public prompts: Map<PromptType, string>;
  private tools: Tool[];
  private emergencyPrompt: string = '';

  constructor(tools: Tool[]) {
    this.prompts = new Map();
    this.tools = tools;
    this.setupPrompts();
  }

  private async setupPrompts(): Promise<void> {
    const promptsName: PromptType[] = ['planning', 'use_tool'];
    for (const name of promptsName) {
      this.prompts.set(name, await loadPrompt(name, 'minebot'));
    }
    // 緊急時用プロンプトを別途読み込み
    this.emergencyPrompt = await loadPrompt('emergency' as PromptType, 'minebot');
  }

  private getPrompt = (promptName: PromptType): string => {
    const prompt = this.prompts.get(promptName);
    if (!prompt) {
      throw new Error('prompt not found');
    }
    return prompt.replace(/\\n/g, '\n').replace(/\\/g, '').replace(/"/g, "'");
  };

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

  public getMessages = (
    state: TaskStateInput,
    promptName: PromptType,
    isToolInfo: boolean = false
  ): BaseMessage[] => {
    const prompt = this.getPrompt(promptName);
    const currentTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    const environmentState = state.environmentState
      ? `environmentState: ${JSON.stringify(state.environmentState, null, 2)
        .replace(/\\n/g, '\n')
        .replace(/\\/g, '')
        .replace(/"/g, "'")}`
      : null;
    const botStatus = state.botStatus
      ? `botStatus: ${JSON.stringify(state.botStatus, null, 2)
        .replace(/\\n/g, '\n')
        .replace(/\\/g, '')
        .replace(/"/g, "'")}`
      : null;
    const toolInfoMessage = isToolInfo
      ? `Available Tools:\n${this.getToolsInfo()}`
      : '';

    // 最新のToolMessageからエラー情報を抽出
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
        errorMessage = `Previous Errors (Attempt ${retryCount + 1}/${CONFIG.MAX_RETRY_COUNT}):\n${errors.join('\n')}\n\n**IMPORTANT: This is attempt ${retryCount + 1} of ${CONFIG.MAX_RETRY_COUNT}. ${retryCount >= CONFIG.MAX_RETRY_COUNT - 2 ? 'Only 2 attempts left! Use ONLY what you can see in Tool Results. NO placeholders like "specific_x"!' : 'Try a completely different approach. READ Tool Results carefully and use EXACT values.'}**`;
      }
    }

    // 緊急時のみ緊急ルールを注入
    const emergencyRules = state.isEmergency && this.emergencyPrompt
      ? this.emergencyPrompt.replace(/\\n/g, '\n').replace(/\\/g, '').replace(/"/g, "'")
      : null;

    const messages = [
      new SystemMessage(prompt),
      // 緊急時のみ緊急ルールを追加
      emergencyRules ? new SystemMessage(emergencyRules) : null,
      state.userMessage
        ? new SystemMessage(`userMessage: ${state.userMessage}`)
        : null,
      new SystemMessage(
        [environmentState, botStatus]
          .filter(Boolean)
          .join('\n')
      ),
      state.taskTree
        ? new SystemMessage(
          `=== Current Task State ===
goal: ${state.taskTree.goal}
strategy: ${state.taskTree.strategy}
status: ${state.taskTree.status}

=== 前回のhierarchicalSubTasks (必ず引き継いで更新すること！) ===
${state.taskTree.hierarchicalSubTasks ? JSON.stringify(state.taskTree.hierarchicalSubTasks, null, 2) : 'null (新規タスク)'}

currentSubTaskId: ${state.taskTree.currentSubTaskId || 'null'}

=== 重要: hierarchicalSubTasksの更新ルール ===
- completed/error → 絶対に変更しない（結果確定済み）
- in_progress → 基本引き継ぎ、子タスク追加はOK
- pending → 修正・削除OK（まだ実行していないので計画変更可能）
- 目標達成に問題なければ基本は引き継ぐ（一貫性のため）
`
        )
        : null,
      errorMessage ? new SystemMessage(errorMessage) : null,
      state.humanFeedback
        ? new SystemMessage(
          `humanFeedback: ${JSON.stringify(state.humanFeedback)}`
        )
        : null,
      isToolInfo ? new SystemMessage(toolInfoMessage) : null,
      // 前回の実行結果を明示的に表示（executionResults）
      state.executionResults && state.executionResults.length > 0
        ? new SystemMessage(
          `=== Previous Execution Results ===\n` +
          `以下はツール実行の結果です。この情報をもとに次のアクションを決定してください。\n` +
          `データが取得済みの場合は、そのデータを分析して chat で回答してください。追加のツール実行は不要です。\n\n` +
          state.executionResults.map((r: any) =>
            `[${r.success ? '成功' : '失敗'}] ${r.toolName} (${r.duration}ms)\n結果: ${r.message}`
          ).join('\n\n')
        )
        : null,
      new SystemMessage(`the actionLog is as follows.`),
      // メッセージを変換して追加
      ...(state.messages?.slice(-CONFIG.MAX_RECENT_MESSAGES).flatMap((msg) => {
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
