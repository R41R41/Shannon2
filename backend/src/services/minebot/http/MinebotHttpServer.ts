import express, { Application } from 'express';
import { Server } from 'http';
import { CONFIG } from '../config/MinebotConfig.js';
import { SkillLoader } from '../skills/SkillLoader.js';
import { CustomBot } from '../types.js';
import {
    ApiResponse,
    ConstantSkillSwitchRequest,
    HttpServerError,
    ThrowItemRequest,
} from '../types/index.js';

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

    constructor(bot: CustomBot, sendConstantSkillsCallback: () => Promise<void>) {
        this.bot = bot;
        this.skillLoader = new SkillLoader();
        this.sendConstantSkillsCallback = sendConstantSkillsCallback;
        this.app = express();
        this.setupMiddleware();
        this.registerEndpoints();
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
        this.app.post('/throw_item', (req: any, res: any) => {
            try {
                const { itemName } = req.body as ThrowItemRequest;
                const throwItem = this.bot.instantSkills.getSkill('throw-item');
                if (!throwItem) {
                    const response: ApiResponse = { success: false, result: 'throw-item not found' };
                    return res.status(404).json(response);
                }
                throwItem.run(itemName.split(':')[1]);
                const response: ApiResponse = { success: true, result: 'throw-item executed' };
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

