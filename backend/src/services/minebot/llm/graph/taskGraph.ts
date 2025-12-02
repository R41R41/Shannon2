import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { TaskInput, TaskTreeState } from '@shannon/common';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Vec3 } from 'vec3';
import { z, ZodObject } from 'zod';
import { EventBus } from '../../../eventBus/eventBus.js';
import { getEventBus } from '../../../eventBus/index.js';
import { CustomBot } from '../../types.js';
import { CustomToolNode } from './customToolNode.js';
import { PlanningNode } from './planningNode.js';
import { Prompt } from './prompt.js';
import { ToolAgentNode } from './toolAgentNode.js';
import { TaskStateInput } from './types.js';
import { UseToolNode } from './useToolNode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// 汎用的なInstantSkillToolクラス
class InstantSkillTool extends StructuredTool {
  name: string;
  description: string;
  schema: ZodObject<any>;
  private bot: CustomBot;

  constructor(skill: any, bot: CustomBot) {
    super();
    this.bot = bot;
    this.name = skill.skillName;
    this.description = skill.description;
    // paramsからzodスキーマを動的生成
    this.schema = z.object(
      Object.fromEntries(
        (skill.params || []).map((param: any) => {
          // 型に応じたzodスキーマを生成
          let zodType;
          switch (param.type) {
            case 'number':
              zodType = z.number();
              break;
            case 'Vec3':
              zodType = z.object({
                x: z.number(),
                y: z.number(),
                z: z.number(),
              });
              break;
            case 'boolean':
              zodType = z.boolean();
              break;
            case 'string':
              zodType = z.string();
            default:
              zodType = z.string();
          }

          // null許容を追加
          zodType = zodType.nullable();

          // デフォルト値があれば設定
          if (param.default !== undefined) {
            // anyでキャストして型の互換性問題を回避
            try {
              zodType = (zodType as any).default(param.default);
            } catch (error) {
              console.error(
                `\x1b[31mデフォルト値の設定に失敗しました: ${error}\x1b[0m`
              );
            }
          }

          // 説明を追加
          zodType = zodType.describe(param.description || '');

          return [param.name, zodType];
        })
      )
    );
  }

  async _call(data: any): Promise<string> {
    const skill = this.bot.instantSkills.getSkill(this.name);
    if (!skill) {
      return `${this.name}スキルが存在しません。`;
    }
    console.log(
      `\x1b[32m${skill.skillName}を実行します。パラメータ：${JSON.stringify(
        data
      )}\x1b[0m`
    );

    try {
      // スキルのパラメータ定義を取得
      const params = skill.params || [];
      const args = params.map((param) => {
        if (param.type === 'Vec3' && data[param.name]) {
          return new Vec3(
            data[param.name].x,
            data[param.name].y,
            data[param.name].z
          );
        } else if (param.type === 'boolean' && data[param.name] === 'true') {
          return true;
        } else if (param.type === 'boolean' && data[param.name] === 'false') {
          return false;
        } else {
          return data[param.name];
        }
      });
      // スキルを実行
      const result = await skill.run(...args);
      return typeof result === 'string'
        ? result
        : `結果: ${result.success ? '成功' : '失敗'} 詳細: ${result.result}`;
    } catch (error) {
      console.error(`${this.name}スキル実行エラー:`, error);
      return `スキル実行エラー: ${error}`;
    }
  }
}

// forceStop/humanFeedbackPending監視用Promise
function waitForStop(state: any) {
  return new Promise((_, reject) => {
    // 最大待機時間（ミリ秒）
    const maxWaitTime = 10000; // 10秒
    let elapsedTime = 0;

    const interval = setInterval(() => {
      // 強制停止または人間フィードバック要求の場合
      if (state.forceStop || state.humanFeedbackPending) {
        clearInterval(interval);
        console.log('waitForStop', state.forceStop, state.humanFeedbackPending);
        reject(new Error('強制終了または人間フィードバック要求で中断'));
        return;
      }

      // 経過時間を増加
      elapsedTime += 100;

      // 最大待機時間を超えた場合
      if (elapsedTime >= maxWaitTime) {
        clearInterval(interval);
        reject(new Error('waitForStop関数がタイムアウトしました'));
      }
    }, 100);
  });
}

// taskTreeをPOST送信する関数
async function sendTaskTreeToServer(taskTree: any) {
  try {
    const response = await fetch('http://localhost:8081/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(taskTree),
    });
    if (!response.ok) {
      console.error(
        'taskTree送信失敗:',
        response.status,
        await response.text()
      );
    } else {
      console.log('taskTree送信成功');
    }
  } catch (error) {
    console.error('taskTree送信エラー:', error);
  }
}

export class TaskGraph {
  private static instance: TaskGraph;
  private tools: any[] = [];
  private customToolNode: CustomToolNode | null = null;
  private planningNode: PlanningNode | null = null;
  private toolAgentNode: ToolAgentNode | null = null;
  private useToolNode: UseToolNode | null = null;
  private graph: any;
  private eventBus: EventBus | null = null;
  private prompt: Prompt | null = null;
  private isRunning: boolean = true;
  private waitSeconds: number | null = null;
  private bot: CustomBot | null = null;
  public currentState: any = null;

  constructor() {
    this.bot = null;
    this.eventBus = null;
    this.customToolNode = null;
    this.planningNode = null;
    this.toolAgentNode = null;
    this.useToolNode = null;
    this.prompt = null;
  }

  public async initialize(bot: CustomBot) {
    this.bot = bot;
    this.eventBus = getEventBus();
    await this.initializeTools();
    await this.initializeEventBus();
    this.prompt = new Prompt(this.tools);

    // 各Nodeを初期化
    this.customToolNode = new CustomToolNode(this.tools);
    this.planningNode = new PlanningNode(this.bot, this.prompt);
    this.toolAgentNode = new ToolAgentNode(this.prompt, this.tools);
    this.useToolNode = new UseToolNode(this.customToolNode);

    this.graph = this.createGraph();
    this.currentState = null;
  }

  public static getInstance(): TaskGraph {
    if (!TaskGraph.instance) {
      TaskGraph.instance = new TaskGraph();
    }
    return TaskGraph.instance;
  }
  private async initializeEventBus() {
    if (!this.eventBus) {
      throw new Error('EventBus not initialized');
    }
    this.eventBus.subscribe('task:stop', (event) => {
      console.log(`タスクを停止します`);
      this.isRunning = false;
      const { waitSeconds } = event.data as TaskInput;
      if (waitSeconds) {
        this.waitSeconds = waitSeconds;
      }
    });
    this.eventBus.subscribe('task:start', () => {
      console.log(`タスクを再開します`);
      this.isRunning = true;
      this.waitSeconds = null;
    });
  }
  public async initializeTools() {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }
    // instantSkillsから全スキルを取得
    this.tools = [];
    const skills = this.bot.instantSkills.getSkills();
    for (const skill of skills) {
      if (!skill.isToolForLLM) continue;
      const skillTool = new InstantSkillTool(skill, this.bot);
      console.log('skillToolName', skillTool.name);
      this.tools.push(skillTool);
    }
    const toolsDir = join(__dirname, '../tools');
    const toolFiles = readdirSync(toolsDir).filter(
      (file) =>
        (file.endsWith('.ts') || file.endsWith('.js')) &&
        !file.includes('.d.ts')
    );

    for (const file of toolFiles) {
      if (file === 'index.ts' || file === 'index.js') continue;

      try {
        const toolModule = await import(join(toolsDir, file));
        const ToolClass = toolModule.default;
        if (ToolClass?.prototype?.constructor) {
          this.tools.push(new ToolClass());
        }
      } catch (error) {
        console.error(`ツール読み込みエラー: ${file}`, error);
      }
    }
    console.log('tools', this.tools.length);
  }

  private TaskState = Annotation.Root({
    taskId: Annotation<string>({
      reducer: (_, next) => next,
      default: () => '',
    }),
    environmentState: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    selfState: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    humanFeedback: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    messages: Annotation<BaseMessage[]>({
      reducer: (prev, next) => {
        if (next === null) {
          return prev;
        } else {
          return prev?.concat(next) ?? next;
        }
      },
      default: () => [],
    }),
    userMessage: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    taskTree: Annotation<TaskTreeState | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),
    // humanFeedbackPendingフラグを追加
    humanFeedbackPending: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
    }),
    retryCount: Annotation<number>({
      reducer: (prev, next) => (next === undefined ? prev : next),
      default: () => 0,
    }),
    forceStop: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
    }),
  });

  private createGraph() {
    if (!this.planningNode || !this.toolAgentNode || !this.useToolNode) {
      throw new Error('Nodes not initialized');
    }

    const workflow = new StateGraph(this.TaskState)
      .addNode('planning', async (state) => {
        // humanFeedbackとretryCountを現在の状態から取得
        state.humanFeedback =
          this.currentState?.humanFeedback || state.humanFeedback;
        state.retryCount = this.currentState?.retryCount || state.retryCount || 0;
        return await this.planningNode!.invoke(state);
      })
      .addNode('tool_agent', async (state) => {
        return await this.toolAgentNode!.invoke(state);
      })
      .addNode('use_tool', async (state) => {
        const result = await this.useToolNode!.invoke(state);

        // ツール実行結果からエラーを判定
        const messages = result.messages || [];
        const lastMessage = messages[messages.length - 1];
        let hasError = false;
        if (lastMessage && 'content' in lastMessage) {
          const content = String(lastMessage.content);
          hasError = content.includes('エラー') || content.includes('失敗') || content.includes('スキップ');
        }

        // retryCountを更新
        let newRetryCount = state.retryCount || 0;
        if (hasError) {
          newRetryCount = newRetryCount + 1;
          this.currentState.retryCount = newRetryCount;
          console.log(`\x1b[33m⚠ エラー発生（再試行回数: ${newRetryCount}/8）\x1b[0m`);
        } else {
          newRetryCount = 0;
          this.currentState.retryCount = 0;
        }

        return { ...result, retryCount: newRetryCount };
      })
      .addEdge(START, 'planning')
      .addConditionalEdges('planning', (state) => {
        if (this.currentState.forceStop) {
          return END;
        }
        if (this.currentState.humanFeedbackPending) {
          this.currentState.humanFeedbackPending = false;
          return 'planning';
        }

        // actionSequenceがある場合は、statusに関係なくtool_agentに進む
        if (
          state.taskTree?.actionSequence &&
          state.taskTree.actionSequence.length > 0
        ) {
          return 'tool_agent';
        }

        if (
          state.taskTree?.status === 'completed' ||
          state.taskTree?.status === 'error'
        ) {
          console.log('\x1b[31mtaskTree completed\x1b[0m');
          return END;
        } else {
          return 'tool_agent';
        }
      })
      .addConditionalEdges('tool_agent', (state) => {
        // humanFeedbackPendingがtrueならplanningに強制遷移
        if (this.currentState.forceStop) {
          return END;
        }
        const lastMessage = state.messages[state.messages.length - 1];
        if (
          lastMessage instanceof AIMessage &&
          Array.isArray(lastMessage.tool_calls) &&
          lastMessage.tool_calls.length > 0
        ) {
          return 'use_tool';
        } else {
          return END;
        }
      })
      .addConditionalEdges('use_tool', (state) => {
        if (this.currentState.forceStop) {
          return END;
        }

        // retryCountをチェック（8回以上失敗したら終了）
        const retryCount = state.retryCount || 0;
        if (retryCount >= 8) {
          console.log(
            `\x1b[31m✗ 最大再試行回数に達しました。タスクを終了します。\x1b[0m`
          );
          return END;
        }

        if (this.currentState.humanFeedbackPending) {
          this.currentState.humanFeedbackPending = false;
          return 'planning';
        }

        // エラーがある場合は必ずplanningに戻る
        // 成功の場合もplanningに戻って最終判定を行う
        return 'planning';
      });
    return workflow.compile();
  }

  public async invoke(partialState: TaskStateInput) {
    let state: typeof this.TaskState.State = {
      taskId: crypto.randomUUID(),
      environmentState: partialState.environmentState ?? null,
      selfState: partialState.selfState ?? null,
      humanFeedback: partialState.humanFeedback ?? null,
      messages: partialState.messages ?? [],
      userMessage: partialState.userMessage ?? null,
      taskTree: {
        status: 'in_progress',
        goal: '',
        strategy: '',
        subTasks: null,
      },
      humanFeedbackPending: false,
      forceStop: false,
      retryCount: 0,
    };
    this.currentState = state;

    try {
      console.log('タスクグラフ実行開始 ID:', state.taskId);
      const result = await this.graph.invoke(state, { recursionLimit: 64 });
      if (result.taskTree?.status === 'in_progress') {
        result.taskTree.status = 'error';
      }

      // 実行後の状態サマリーをログ出力
      console.log('タスクグラフ完了:', {
        taskId: result.taskId,
        status: result.taskTree?.status,
        wasForceStop: result.forceStop,
        messageCount: result.messages.length,
      });

      this.currentState = result;

      return result;
    } catch (error) {
      // 再帰制限エラーの場合
      if (error instanceof Error && 'lc_error_code' in error) {
        if (error.lc_error_code === 'GRAPH_RECURSION_LIMIT') {
          console.warn('再帰制限に達しました。タスクを強制終了します。');
          return {
            ...state,
            taskTree: {
              status: 'error',
              goal: '再帰制限エラーにより強制終了',
              strategy: '',
              subTasks: null,
            },
          };
        }
      }

      // その他のエラーの場合
      console.error('タスクグラフ実行エラー:', error);
      return {
        ...state,
        taskTree: {
          status: 'error',
          goal: `エラーにより強制終了: ${error instanceof Error ? error.message : '不明なエラー'
            }`,
          strategy: '',
          subTasks: null,
        },
      };
    }
  }

  // humanFeedbackを更新
  public updateHumanFeedback(feedback: string) {
    console.log('updateHumanFeedback', feedback);
    if (this.currentState) {
      this.currentState.humanFeedback = feedback;
      this.currentState.humanFeedbackPending = true;
      console.log('humanFeedbackが更新されました:', feedback);
    }
  }

  // タスクを強制終了
  public forceStop() {
    console.log('forceStop');
    if (this.currentState) {
      this.currentState.forceStop = true;
    }
  }
}
