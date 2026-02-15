import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import { pull } from 'langchain/hub';
import { TwitterTrendData } from '@shannon/common';
import { loadPrompt } from '../config/prompts.js';
import { models } from '../../../config/models.js';
import GoogleSearchTool from '../tools/googleSearch.js';

/**
 * AutoTweetAgent: トレンド情報を元にシャノンのキャラでツイートを自動生成する
 */
export class AutoTweetAgent {
  private model: ChatOpenAI;
  private systemPrompt: string;
  private tools: StructuredTool[];
  private agent: Runnable | null;
  private executor: AgentExecutor | null;

  private constructor(systemPrompt: string) {
    this.model = new ChatOpenAI({
      modelName: models.autoTweet,
      temperature: 1, // FTモデルは temperature=1 のみサポート
    });
    this.systemPrompt = systemPrompt;
    this.agent = null;
    this.executor = null;
    this.tools = [];
    this.setTools();
  }

  public static async create(): Promise<AutoTweetAgent> {
    const prompt = await loadPrompt('auto_tweet');
    if (!prompt) {
      throw new Error('Failed to load auto_tweet prompt');
    }
    const agent = new AutoTweetAgent(prompt);
    await agent.initializeAgent();
    return agent;
  }

  private setTools() {
    const googleSearchTool = new GoogleSearchTool();
    this.tools = [googleSearchTool];
  }

  private async initializeAgent() {
    const prompt = (await pull(
      'hwchase17/openai-tools-agent'
    )) as ChatPromptTemplate;
    this.agent = await createOpenAIToolsAgent({
      llm: this.model,
      tools: this.tools,
      prompt: prompt,
    });
    this.executor = new AgentExecutor({
      agent: this.agent,
      tools: this.tools,
      verbose: false,
      maxIterations: 5,
    });
  }

  /**
   * トレンドデータと今日の情報からツイートを生成する
   */
  public async generateTweet(
    trends: TwitterTrendData[],
    todayInfo: string
  ): Promise<string> {
    if (!this.executor) {
      throw new Error('Executor is not initialized');
    }

    const trendsText = trends
      .map((t) => `${t.rank}. ${t.name}${t.metaDescription ? ` - ${t.metaDescription}` : ''}`)
      .join('\n');

    const input = [
      this.systemPrompt,
      '',
      `# 今日の情報`,
      todayInfo,
      '',
      `# 現在のトレンド (日本)`,
      trendsText,
    ].join('\n');

    try {
      const result = await this.executor.invoke({ input });
      const output = result.output?.trim();

      if (
        !output ||
        output.includes('Agent stopped due to max iterations.')
      ) {
        console.warn('🐦 AutoTweetAgent: 生成失敗またはmax iterations');
        return '';
      }

      // 140文字超えの場合は切り詰め
      if (output.length > 140) {
        console.warn(
          `🐦 AutoTweetAgent: 出力が${output.length}文字。140文字に切り詰め`
        );
        return output.slice(0, 140);
      }

      return output;
    } catch (error) {
      console.error('🐦 AutoTweetAgent error:', error);
      return '';
    }
  }
}
