import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { loadPrompt } from '../config/prompts.js';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import { SystemMessage } from '@langchain/core/messages';
import BingSearchTool from '../tools/googleSearch.js';
const jst = 'Asia/Tokyo';
import { pull } from 'langchain/hub';
import { ChatPromptTemplate } from '@langchain/core/prompts';

export class PostAboutTodayAgent {
  private model: ChatOpenAI;
  private systemPrompt: string;
  private tools: any[];
  private agent: any;
  private executor: AgentExecutor | null;

  private constructor(systemPrompt: string) {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0,
    });
    this.systemPrompt = systemPrompt;
    this.executor = null;
    this.tools = [];
    this.setTools();
    this.initializeAgent();
  }

  public static async create(): Promise<PostAboutTodayAgent> {
    const prompt = await loadPrompt('about_today');
    if (!prompt) {
      throw new Error('Failed to load about_today prompt');
    }
    return new PostAboutTodayAgent(prompt);
  }

  private setTools() {
    const bingSearchTool = new BingSearchTool();
    this.tools = [bingSearchTool];
  }

  private async initializeAgent() {
    // AgentのPromptをHubから取得
    const prompt = (await pull(
      'hwchase17/openai-tools-agent'
    )) as ChatPromptTemplate;

    // Agentを作成
    this.agent = await createOpenAIToolsAgent({
      llm: this.model,
      tools: this.tools,
      prompt: prompt,
    });

    // ExecutorでAgentを実行可能に
    this.executor = new AgentExecutor({
      agent: this.agent,
      tools: this.tools,
      verbose: true,
    });
  }

  private async llm(systemPrompt: string): Promise<string> {
    if (!this.executor) {
      throw new Error('Executor is not initialized');
    }
    try {
      // AgentExecutorを使用して実行
      const result = await this.executor.invoke({
        input: systemPrompt,
      });

      return result.output;
    } catch (error) {
      console.error('Agent execution error:', error);
      throw error;
    }
  }

  private getTodayDate(): string {
    const today = new Date();
    return format(toZonedTime(today, jst), 'yyyy-MM-dd');
  }

  public async createPost(): Promise<string> {
    const today = this.getTodayDate();
    const infoMessage = `date:${today}`;
    const result = await this.llm(this.systemPrompt + '\n' + infoMessage);
    return `【今日は何の日？】\n${result}`;
  }
}
