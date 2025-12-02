import { AIMessage, BaseMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { Tool } from '@langchain/core/tools';
import { PromptType } from '@shannon/common';
import { loadPrompt } from '../config/prompts.js';
import { TaskStateInput } from './types.js';

export class Prompt {
  public prompts: Map<PromptType, string>;
  private tools: Tool[];

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
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.schema, // JSONSchemaの形式でパラメータ情報を含む
      }))
      .map((tool) => `Tool: ${tool.name}\nDescription: ${tool.description}`)
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
    const selfState = state.selfState
      ? `selfState: ${JSON.stringify(state.selfState, null, 2)
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
        errorMessage = `Previous Errors (Attempt ${retryCount + 1}/8):\n${errors.join('\n')}\n\n**IMPORTANT: This is attempt ${retryCount + 1} of 8. ${retryCount >= 6 ? 'Only 2 attempts left! Use ONLY what you can see in Tool Results. NO placeholders like "specific_x"!' : 'Try a completely different approach. READ Tool Results carefully and use EXACT values.'}**`;
      }
    }

    const messages = [
      new SystemMessage(prompt),
      state.userMessage
        ? new SystemMessage(`userMessage: ${state.userMessage}`)
        : null,
      new SystemMessage(
        [environmentState, selfState]
          .filter(Boolean)
          .join('\n')
      ),
      state.taskTree
        ? new SystemMessage(
          `goal: ${state.taskTree.goal}\nstrategy: ${state.taskTree.strategy
          }\nstatus: ${state.taskTree.status}\nsubTasks: ${JSON.stringify(
            state.taskTree.subTasks
          )}`
        )
        : null,
      errorMessage ? new SystemMessage(errorMessage) : null,
      state.humanFeedback
        ? new SystemMessage(
          `humanFeedback: ${JSON.stringify(state.humanFeedback)}`
        )
        : null,
      isToolInfo ? new SystemMessage(toolInfoMessage) : null,
      new SystemMessage(`the actionLog is as follows.`),
      // メッセージを変換して追加
      ...(state.messages?.slice(-8).flatMap((msg) => {
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
