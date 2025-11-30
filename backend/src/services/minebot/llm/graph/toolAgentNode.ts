import { AIMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { Prompt } from './prompt.js';

// forceStop/humanFeedbackPending監視用Promise
function waitForStop(state: any) {
  return new Promise((_, reject) => {
    const maxWaitTime = 10000; // 10秒
    let elapsedTime = 0;

    const interval = setInterval(() => {
      if (state.forceStop || state.humanFeedbackPending) {
        clearInterval(interval);
        reject(new Error('強制終了または人間フィードバック要求で中断'));
        return;
      }

      elapsedTime += 100;
      if (elapsedTime >= maxWaitTime) {
        clearInterval(interval);
        reject(new Error('waitForStop関数がタイムアウトしました'));
      }
    }, 100);
  });
}

/**
 * Tool Agent Node: ツール選択とactionSequence処理
 * 使用モデル: gpt-4o (ツール選択に最適、高速)
 */
export class ToolAgentNode {
  private model: ChatOpenAI;
  private prompt: Prompt;
  private tools: StructuredTool[];

  constructor(prompt: Prompt, tools: StructuredTool[]) {
    this.prompt = prompt;
    this.tools = tools;

    // gpt-4.1を使用（最新の汎用モデル、2025-11-30更新）
    // gpt-4oより性能向上（$2.00/$8.00 per 1M tokens）
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1',
      apiKey: process.env.OPENAI_API_KEY!,
      temperature: 0.8,
    });
  }

  async invoke(state: any): Promise<any> {
    console.log('🔧 ToolAgentNode: ツールを選択中...');

    // actionSequenceがあれば、それを使って複数ツールを一度に呼び出す
    if (
      state.taskTree?.actionSequence &&
      state.taskTree.actionSequence.length > 0
    ) {
      console.log(
        `📦 actionSequenceを実行: ${state.taskTree.actionSequence.length}個のアクション`
      );

      // 複数のtool_callsを含むAIMessageを構築
      const toolCalls = state.taskTree.actionSequence.map(
        (action: any, index: number) => ({
          name: action.toolName,
          args: action.args,
          id: `call_${Date.now()}_${index}`,
        })
      );

      const aiMessage = new AIMessage({
        content: `${state.taskTree.actionSequence.length}個のアクションを順次実行します`,
        tool_calls: toolCalls,
      });

      return { messages: [aiMessage] };
    }

    // 従来の方式（LLMに判断させる）
    console.log('🤖 LLMにツール選択を依頼...');
    const messages = this.prompt.getMessages(state, 'use_tool', false);
    const llmWithTools = this.model.bindTools(this.tools);
    const forcedToolLLM = llmWithTools.bind({
      tool_choice: 'any',
    });

    try {
      // 中断条件をチェック
      if (state.forceStop || state.humanFeedbackPending) {
        console.log('⚠️ ToolAgentNode: 既に中断条件が満たされています');
        throw new Error('強制終了または人間フィードバック要求で中断');
      }

      const result = await Promise.race([
        forcedToolLLM.invoke(messages),
        waitForStop(state),
      ]);

      if (state.forceStop) {
        return {
          taskTree: {
            status: 'error',
            goal: '強制終了されました',
            strategy: '',
            subTasks: null,
          },
        };
      }

      console.log('✅ ツール選択完了');
      return { messages: [result] };
    } catch (error) {
      console.error('❌ ToolAgentNode error:', error);
      return {
        taskTree: {
          status: 'error',
          goal: `エラー: ${
            error instanceof Error ? error.message : '不明なエラー'
          }`,
          strategy: '',
          subTasks: null,
        },
      };
    }
  }
}
