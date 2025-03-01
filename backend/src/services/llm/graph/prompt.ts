import {
  AIMessage,
  BaseMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { loadPrompt } from '../config/prompts.js';
import { PromptType } from '@shannon/common';
import { TaskStateInput } from './types.js';
import { Tool } from '@langchain/core/tools';

export class Prompt {
  public prompts: Map<PromptType, string>;
  private tools: Tool[];

  constructor(tools: Tool[]) {
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
    isMemoryZone: boolean = false,
    isToolInfo: boolean = false,
    isTaskId: boolean = false
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
    const currentTimeMessage = `currentTime: ${currentTime}`;
    const memoryZoneMessage = isMemoryZone
      ? `memoryZone: ${state.memoryZone}`
      : '';
    const toolInfoMessage = isToolInfo
      ? `Available Tools:\n${this.getToolsInfo()}`
      : '';
    const messages = [
      isTaskId ? new SystemMessage(`taskId: ${state.taskId}`) : null,
      new SystemMessage(prompt),
      state.userMessage
        ? new SystemMessage(`userMessage: ${state.userMessage}`)
        : null,
      new SystemMessage(
        [environmentState, currentTimeMessage, memoryZoneMessage]
          .filter(Boolean)
          .join('\n')
      ),
      state.selfState
        ? new SystemMessage(`selfState: ${JSON.stringify(state.selfState)}`)
        : null,
      state.taskTree
        ? new SystemMessage(
            `goal: ${state.taskTree.goal}\nstrategy: ${
              state.taskTree.strategy
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
      ...(state.messages
        ?.reduce((validMessages: BaseMessage[], message, index, array) => {
          if (message instanceof ToolMessage) {
            // 直前のメッセージがAIMessageでtool_callsを持っているか確認
            const prevMessage = array[index - 1];
            if (
              prevMessage instanceof AIMessage &&
              prevMessage.additional_kwargs.tool_calls
            ) {
              validMessages.push(message);
            }
          } else {
            validMessages.push(message);
          }
          return validMessages;
        }, [])
        .slice(-8) ?? []),
    ].filter((message): message is BaseMessage => message !== null);

    return messages;
  };
}
