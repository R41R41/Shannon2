import express, { Application } from 'express';
import { Server } from 'http';
import { CONFIG } from '../config/MinebotConfig.js';
import { EventReactionSystem } from '../eventReaction/EventReactionSystem.js';
import { SkillLoader } from '../skills/SkillLoader.js';
import { CustomBot } from '../types.js';
import {
    ApiResponse,
    ConstantSkillSwitchRequest,
    HttpServerError,
    ThrowItemRequest,
} from '../types/index.js';

// 反応設定の更新リクエスト型
interface ReactionSettingUpdateRequest {
    eventType: string;
    enabled?: boolean;
    probability?: number;
}

// チャットメッセージリクエスト型
interface ChatMessageRequest {
    sender: string;
    message: string;
}

/**
 * MinebotHttpServer
 * Express APIサーバーの管理を担当
 */
export class MinebotHttpServer {
    private app: Application;
    private server: Server | null = null;
    private bot: CustomBot;
    private skillLoader: SkillLoader;
    private sendConstantSkillsCallback: () => Promise<void>;
    private sendReactionSettingsCallback: () => Promise<void>;
    private onChatMessageCallback: ((sender: string, message: string) => Promise<void>) | null = null;
    private eventReactionSystem: EventReactionSystem | null = null;

    constructor(
        bot: CustomBot,
        sendConstantSkillsCallback: () => Promise<void>,
        sendReactionSettingsCallback?: () => Promise<void>
    ) {
        this.bot = bot;
        this.skillLoader = new SkillLoader();
        this.sendConstantSkillsCallback = sendConstantSkillsCallback;
        this.sendReactionSettingsCallback = sendReactionSettingsCallback || (async () => { });
        this.app = express();
        this.setupMiddleware();
        this.registerEndpoints();
    }

    /**
     * チャットメッセージコールバックを設定
     */
    setOnChatMessageCallback(callback: (sender: string, message: string) => Promise<void>): void {
        this.onChatMessageCallback = callback;
    }

    /**
     * EventReactionSystemを設定
     */
    setEventReactionSystem(system: EventReactionSystem): void {
        this.eventReactionSystem = system;
    }

    /**
     * ミドルウェアの設定
     */
    private setupMiddleware(): void {
        this.app.use(express.json());
    }

    /**
     * エンドポイントの登録
     */
    private registerEndpoints(): void {
        // アイテム投げ捨てエンドポイント
        this.app.post('/throw_item', async (req: any, res: any) => {
            try {
                const { itemName } = req.body as ThrowItemRequest;
                const dropItem = this.bot.instantSkills.getSkill('drop-item');
                if (!dropItem) {
                    const response: ApiResponse = { success: false, result: 'drop-item skill not found' };
                    return res.status(404).json(response);
                }

                // minecraft:oak_log -> oak_log の形式変換
                const cleanItemName = itemName.includes(':') ? itemName.split(':')[1] : itemName;
                const result = await dropItem.run(cleanItemName, 1);

                console.log(`📦 アイテムドロップ: ${cleanItemName} -> ${result.result}`);
                const response: ApiResponse = { success: result.success, result: result.result };
                res.status(200).json(response);
            } catch (error) {
                const httpError = new HttpServerError('/throw_item', 500, error as Error);
                console.error(httpError.toJSON());
                const response: ApiResponse = {
                    success: false,
                    result: httpError.message,
                    error: httpError.code
                };
                res.status(500).json(response);
            }
        });

        // コンスタントスキル切り替えエンドポイント
        this.app.post('/constant_skill_switch', async (req: any, res: any) => {
            try {
                const { skillName, status } = req.body as ConstantSkillSwitchRequest;
                const constantSkill = this.bot.constantSkills.getSkill(skillName);
                if (!constantSkill) {
                    return res
                        .status(404)
                        .json({ success: false, result: 'constant skill not found' });
                }

                constantSkill.status = status === 'true';

                // JSONファイルを更新
                const savedSkills = this.skillLoader.loadConstantSkillsState();

                // 既存のスキルを更新または新規追加
                const existingSkillIndex = savedSkills.findIndex(
                    (s) => s.skillName === skillName
                );
                if (existingSkillIndex !== -1) {
                    savedSkills[existingSkillIndex].status = constantSkill.status;
                } else {
                    savedSkills.push({
                        skillName: skillName,
                        status: constantSkill.status,
                    });
                }

                // JSONファイルに保存
                this.skillLoader.saveConstantSkillsState(
                    savedSkills.map(s => {
                        const skill = this.bot.constantSkills.getSkill(s.skillName);
                        return skill || ({ skillName: s.skillName, status: s.status } as any);
                    })
                );

                // auto-followスキルの特別処理
                if (skillName === 'auto-follow') {
                    if (constantSkill.status) {
                        const autoFollow = this.bot.constantSkills.getSkill('auto-follow');
                        if (autoFollow) {
                            const players = Object.values(this.bot.entities).filter(
                                (entity) =>
                                    entity.name === 'player' &&
                                    entity.username !== this.bot.username
                            );
                            const nearestPlayer = players.sort(
                                (a, b) =>
                                    a.position.distanceTo(this.bot.entity.position) -
                                    b.position.distanceTo(this.bot.entity.position)
                            )[0];
                            if (nearestPlayer) {
                                autoFollow.run(nearestPlayer.username);
                            }
                        }
                    } else {
                        const autoFollow = this.bot.constantSkills.getSkill('auto-follow');
                        if (autoFollow) {
                            autoFollow.status = false;
                        }
                    }
                }

                const response: ApiResponse = { success: true, result: 'constant skill status updated' };
                res.status(200).json(response);
            } catch (error) {
                const httpError = new HttpServerError('/constant_skill_switch', 500, error as Error);
                console.error(httpError.toJSON());
                const response: ApiResponse = {
                    success: false,
                    result: httpError.message,
                    error: httpError.code
                };
                res.status(500).json(response);
            } finally {
                await this.sendConstantSkillsCallback();
            }
        });

        // 反応設定更新エンドポイント
        this.app.post('/reaction_setting_update', async (req: any, res: any) => {
            try {
                const { eventType, enabled, probability } = req.body as ReactionSettingUpdateRequest;

                // EventReactionSystemで設定を更新
                if (this.eventReactionSystem) {
                    this.eventReactionSystem.updateConfig(eventType as any, {
                        enabled,
                        probability,
                    });
                    console.log(`📝 反応設定更新: ${eventType} -> enabled=${enabled}, probability=${probability}`);
                }

                const response: ApiResponse = {
                    success: true,
                    result: `reaction setting for ${eventType} updated`,
                    data: { eventType, enabled, probability }
                };
                res.status(200).json(response);
            } catch (error) {
                const httpError = new HttpServerError('/reaction_setting_update', 500, error as Error);
                console.error(httpError.toJSON());
                const response: ApiResponse = {
                    success: false,
                    result: httpError.message,
                    error: httpError.code
                };
                res.status(500).json(response);
            } finally {
                await this.sendReactionSettingsCallback();
            }
        });

        // 反応設定リセットエンドポイント
        this.app.post('/reaction_settings_reset', async (req: any, res: any) => {
            try {
                // EventReactionSystemで設定をリセット
                if (this.eventReactionSystem) {
                    this.eventReactionSystem.resetConfigs();
                    console.log('📝 反応設定をリセットしました');
                }

                const response: ApiResponse = {
                    success: true,
                    result: 'reaction settings reset'
                };
                res.status(200).json(response);
            } catch (error) {
                const httpError = new HttpServerError('/reaction_settings_reset', 500, error as Error);
                console.error(httpError.toJSON());
                const response: ApiResponse = {
                    success: false,
                    result: httpError.message,
                    error: httpError.code
                };
                res.status(500).json(response);
            } finally {
                await this.sendReactionSettingsCallback();
            }
        });

        // 反応設定取得エンドポイント（GET）
        this.app.get('/reaction_settings', async (req: any, res: any) => {
            try {
                // EventReactionSystemから設定を取得
                if (this.eventReactionSystem) {
                    const settings = this.eventReactionSystem.getSettingsState();
                    res.status(200).json({
                        reactions: settings.reactions,
                        constantSkills: [], // 常時スキルは常時スキルタブで管理
                    });
                } else {
                    // EventReactionSystemがまだ設定されていない場合はデフォルト設定
                    const reactions = [
                        { eventType: 'player_facing', enabled: true, probability: 30, idleOnly: true, reactionType: 'task' },
                        { eventType: 'player_speak', enabled: true, probability: 100, idleOnly: false, reactionType: 'task' },
                        { eventType: 'hostile_approach', enabled: true, probability: 100, idleOnly: false, reactionType: 'task' },
                        { eventType: 'item_obtained', enabled: true, probability: 30, idleOnly: true, reactionType: 'task' },
                        { eventType: 'time_change', enabled: true, probability: 30, idleOnly: false, reactionType: 'task' },
                        { eventType: 'weather_change', enabled: true, probability: 30, idleOnly: false, reactionType: 'task' },
                        { eventType: 'biome_change', enabled: true, probability: 50, idleOnly: false, reactionType: 'task' },
                        { eventType: 'teleported', enabled: true, probability: 100, idleOnly: false, reactionType: 'task' },
                        { eventType: 'damage', enabled: true, probability: 100, idleOnly: false, reactionType: 'task' },
                        { eventType: 'suffocation', enabled: true, probability: 100, idleOnly: false, reactionType: 'emergency' },
                    ];
                    res.status(200).json({
                        reactions,
                        constantSkills: [],
                    });
                }
            } catch (error) {
                const httpError = new HttpServerError('/reaction_settings', 500, error as Error);
                console.error(httpError.toJSON());
                res.status(500).json({
                    success: false,
                    result: httpError.message,
                });
            }
        });

        // チャットメッセージエンドポイント
        this.app.post('/chat_message', async (req: any, res: any) => {
            try {
                const { sender, message } = req.body as ChatMessageRequest;
                console.log(`💬 Chat from ${sender}: ${message}`);

                if (this.onChatMessageCallback) {
                    await this.onChatMessageCallback(sender, message);
                }

                const response: ApiResponse = {
                    success: true,
                    result: 'Message received'
                };
                res.status(200).json(response);
            } catch (error) {
                const httpError = new HttpServerError('/chat_message', 500, error as Error);
                console.error(httpError.toJSON());
                res.status(500).json({
                    success: false,
                    result: httpError.message,
                });
            }
        });

        // タスクリスト取得エンドポイント
        this.app.get('/task_list', async (req: any, res: any) => {
            try {
                const taskGraph = (this.bot as any).taskGraph;
                if (!taskGraph) {
                    return res.status(200).json({ tasks: [], emergencyTask: null, currentTaskId: null });
                }
                const taskListState = taskGraph.getTaskListState();
                res.status(200).json(taskListState);
            } catch (error) {
                const httpError = new HttpServerError('/task_list', 500, error as Error);
                console.error(httpError.toJSON());
                res.status(500).json({ success: false, result: httpError.message });
            }
        });

        // タスク削除エンドポイント
        this.app.post('/task_delete', async (req: any, res: any) => {
            try {
                const { taskId } = req.body;
                if (!taskId) {
                    return res.status(400).json({ success: false, result: 'taskId is required' });
                }

                const taskGraph = (this.bot as any).taskGraph;
                if (!taskGraph) {
                    return res.status(400).json({ success: false, result: 'TaskGraph not initialized' });
                }

                const result = taskGraph.removeTask(taskId);
                res.status(200).json(result);
            } catch (error) {
                const httpError = new HttpServerError('/task_delete', 500, error as Error);
                console.error(httpError.toJSON());
                res.status(500).json({ success: false, result: httpError.message });
            }
        });

        // タスク優先実行エンドポイント
        this.app.post('/task_prioritize', async (req: any, res: any) => {
            try {
                const { taskId } = req.body;
                if (!taskId) {
                    return res.status(400).json({ success: false, result: 'taskId is required' });
                }

                const taskGraph = (this.bot as any).taskGraph;
                if (!taskGraph) {
                    return res.status(400).json({ success: false, result: 'TaskGraph not initialized' });
                }

                const result = taskGraph.prioritizeTask(taskId);
                res.status(200).json(result);
            } catch (error) {
                const httpError = new HttpServerError('/task_prioritize', 500, error as Error);
                console.error(httpError.toJSON());
                res.status(500).json({ success: false, result: httpError.message });
            }
        });

        console.log('✅ API endpoints registered');
    }

    /**
     * サーバーを起動
     */
    start(): void {
        if (this.server) {
            console.log('⚠️ Server is already running');
            return;
        }

        this.server = this.app.listen(CONFIG.MINEBOT_API_PORT, () => {
            console.log(`✅ Express server listening on port ${CONFIG.MINEBOT_API_PORT}`);
        });
    }

    /**
     * サーバーを停止
     */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve();
                return;
            }

            this.server.close(() => {
                console.log('Express server closed');
                this.server = null;
                resolve();
            });
        });
    }

    /**
     * サーバーインスタンスを取得
     */
    getServer(): Server | null {
        return this.server;
    }
}

