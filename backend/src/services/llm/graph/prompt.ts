import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { loadPrompt } from '../config/prompts.js';
import { PromptType } from '@shannon/common';
import { TaskStateInput } from './types.js';

export class Prompt {
  public prompts: Map<PromptType, string>;
  constructor() {
    this.prompts = new Map();
    this.setupPrompts();
  }

  private async setupPrompts(): Promise<void> {
    const promptsName: PromptType[] = [
      'planning',
      'emotion',
      'make_message',
      'send_message',
      'use_tool',
    ];
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

  public getMessages = (
    state: TaskStateInput,
    promptName: PromptType,
    isMemoryZone: boolean = false
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
    const messages = [
      new SystemMessage(currentTimeMessage),
      new SystemMessage(prompt),
      ...(state.messages?.slice(-16) ?? []),
      state.responseMessage
        ? new SystemMessage(`responseMessage: ${state.responseMessage}`)
        : null,
      state.taskTree
        ? new SystemMessage(
            `goal: ${state.taskTree.goal}\nplan: ${
              state.taskTree.plan
            }\nsubTasks: ${JSON.stringify(state.taskTree.subTasks)}`
          )
        : null,
      new SystemMessage(
        [environmentState, currentTimeMessage, memoryZoneMessage]
          .filter(Boolean)
          .join('\n')
      ),
      state.selfState
        ? new SystemMessage(`selfState: ${JSON.stringify(state.selfState)}`)
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
        ? new SystemMessage(`yourEmotion: ${JSON.stringify(state.emotion)}`)
        : null,
    ].filter((message): message is BaseMessage => message !== null);

    return messages;
  };
}
