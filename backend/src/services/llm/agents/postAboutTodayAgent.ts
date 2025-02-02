import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { loadPrompt } from '../config/prompts.js';
import { TaskGraph } from '../graph/taskGraph.js';
const jst = 'Asia/Tokyo';

export class PostAboutTodayAgent {
  private taskGraph: TaskGraph;
  private systemPrompt: string;

  private constructor(systemPrompt: string) {
    this.taskGraph = new TaskGraph();
    this.systemPrompt = systemPrompt;
  }

  public static async create(): Promise<PostAboutTodayAgent> {
    const prompt = await loadPrompt('about_today');
    if (!prompt) {
      throw new Error('Failed to load about_today prompt');
    }
    return new PostAboutTodayAgent(prompt);
  }

  private getTodayDate(): string {
    const now = toZonedTime(new Date(), jst);
    return format(now, 'MMdd');
  }

  public async createPost(): Promise<string> {
    if (!this.systemPrompt) {
      throw new Error('systemPrompt is not set');
    }
    const systemContent = this.systemPrompt;
    const today = this.getTodayDate();
    const infoMessage = `date:${today}`;
    const result = await this.taskGraph.invoke({
      memoryZone: 'discord:toyama_server',
      systemPrompt: systemContent,
      infoMessage: infoMessage,
      messages: [],
      taskTree: {
        goal: '',
        plan: '',
        status: 'pending',
        subTasks: [],
      },
      conversationHistory: {
        messages: [],
      },
      decision: '',
    });
    const aboutTodayMessage =
      result.messages[result.messages.length - 1].content.toString();
    return `【今日は何の日？】\n${aboutTodayMessage}`;
  }
}
