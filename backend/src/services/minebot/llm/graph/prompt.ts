import { BaseMessage, SystemMessage } from '@langchain/core/messages';
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
      state.humanFeedback
        ? new SystemMessage(
          `humanFeedback: ${JSON.stringify(state.humanFeedback)}`
        )
        : null,
      isToolInfo ? new SystemMessage(toolInfoMessage) : null,
      new SystemMessage(`the actionLog is as follows.`),
      ...(state.messages?.slice(-8) ?? []),
    ].filter((message): message is BaseMessage => message !== null);

    return messages;
  };
}
