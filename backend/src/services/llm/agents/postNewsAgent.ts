import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { loadPrompt } from '../config/prompts.js';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import GoogleSearchTool from '../tools/googleSearch.js';
import { pull } from 'langchain/hub';
import { ChatPromptTemplate } from '@langchain/core/prompts';

const jst = 'Asia/Tokyo';

export class PostNewsAgent {
    private model: ChatOpenAI;
    private systemPrompt: string;
    private tools: any[];
    private agent: any;
    private executor: AgentExecutor | null;

    private constructor(systemPrompt: string) {
        this.model = new ChatOpenAI({
            modelName: 'o4-mini',
        });
        this.systemPrompt = systemPrompt;
        this.executor = null;
        this.tools = [];
        this.setTools();
    }

    public static async create(): Promise<PostNewsAgent> {
        const prompt = await loadPrompt('news_today');
        if (!prompt) {
            throw new Error('Failed to load news_today prompt');
        }
        const agent = new PostNewsAgent(prompt);
        await agent.initializeAgent();
        return agent;
    }

    private setTools() {
        const googleSearchTool = new GoogleSearchTool();
        this.tools = [googleSearchTool];
    }

    private async initializeAgent() {
        const prompt = (await pull('hwchase17/openai-tools-agent')) as ChatPromptTemplate;
        this.agent = await createOpenAIToolsAgent({
            llm: this.model,
            tools: this.tools,
            prompt: prompt,
        });
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
        const infoMessage = `今日の日付:${today}\nジャンル:AI`;
        const result = await this.llm(this.systemPrompt + '\n' + infoMessage);
        if (result.includes('Agent stopped due to max iterations.')) {
            return `【今日${format(toZonedTime(new Date(), jst), 'M月d日')}のAIニュース】\n調査回数の上限に達したため、AIニュースの生成に失敗しました。`;
        }
        return `【今日${format(toZonedTime(new Date(), jst), 'M月d日')}のAIニュース】\n${result}`;
    }
}
