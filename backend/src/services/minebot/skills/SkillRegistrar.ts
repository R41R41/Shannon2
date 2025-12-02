import { MinebotSkillInput } from '@shannon/common';
import { EventBus } from '../../eventBus/eventBus.js';
import { ConstantSkills, CustomBot, InstantSkills } from '../types.js';
import { SkillLoader } from './SkillLoader.js';

/**
 * SkillRegistrar
 * スキルとEventBusの紐付けを担当
 */
export class SkillRegistrar {
    private eventBus: EventBus;
    private skillLoader: SkillLoader;

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
        this.skillLoader = new SkillLoader();
    }

    /**
     * InstantSkillsをEventBusに登録
     */
    registerInstantSkills(instantSkills: InstantSkills): void {
        console.log('📝 Registering instant skills to EventBus...');

        instantSkills.getSkills().forEach((skill) => {

            this.eventBus.subscribe(`minebot:${skill.skillName}`, async (event) => {
                try {
                    const parameters = event.data as any;
                    skill.status = true;
                    const response = await skill.run(...parameters);
                    skill.status = false;

                    this.eventBus.publish({
                        type: `minebot:${skill.skillName}Result`,
                        memoryZone: 'minecraft',
                        data: response,
                    });
                } catch (error: any) {
                    this.eventBus.publish({
                        type: `minebot:${skill.skillName}Result`,
                        memoryZone: 'minecraft',
                        data: {
                            success: false,
                            result: error,
                        },
                    });
                }
            });
        });

        console.log(`✅ Registered ${instantSkills.getSkills().length} instant skills`);
    }

    /**
     * ConstantSkillsをEventBusに登録し、定期実行を設定
     */
    registerConstantSkills(bot: CustomBot, constantSkills: ConstantSkills): void {
        console.log('📝 Registering constant skills...');

        // JSONファイルから保存された状態を読み込む
        const savedSkills = this.skillLoader.loadConstantSkillsState();

        constantSkills.getSkills().forEach((skill) => {
            // 保存されたstatusがあれば適用
            const savedSkill = savedSkills.find((s) => s.skillName === skill.skillName);
            if (savedSkill) {
                skill.status = savedSkill.status;
            }

            if (skill.interval && skill.interval > 0) {
                bot.on(`taskPer${skill.interval}ms`, async () => {
                    if (skill.status && !skill.isLocked) {
                        try {
                            await constantSkills.requestExecution(skill, []);
                        } catch (error: any) {
                            this.eventBus.log(
                                'minecraft',
                                'red',
                                `${skill.skillName} error: ${error}`
                            );
                        }
                    }
                });
            }
        });

        console.log(`✅ Registered ${constantSkills.getSkills().length} constant skills`);
    }

    /**
     * EventBus経由のスキル制御イベントを登録
     */
    registerSkillControlEvents(bot: CustomBot): void {
        console.log('📝 Registering skill control events...');

        // スキル停止イベント
        this.eventBus.subscribe('minebot:stopInstantSkill', async (event) => {
            try {
                const { skillName } = event.data as MinebotSkillInput;
                if (!skillName) {
                    return;
                }
                const instantSkill = bot.instantSkills.getSkill(skillName);
                if (!instantSkill) {
                    bot.chat(`${skillName}は存在しません`);
                    return;
                }
                instantSkill.status = false;
                this.eventBus.publish({
                    type: `minebot:skillResult`,
                    memoryZone: 'minecraft',
                    data: {
                        skillName: skillName,
                        success: true,
                        result: `${skillName} stopped`,
                    },
                });
            } catch (error) {
                const { skillName } = event.data as MinebotSkillInput;
                this.eventBus.publish({
                    type: `minebot:skillResult`,
                    memoryZone: 'minecraft',
                    data: {
                        skillName: skillName,
                        success: false,
                        result: `error: ${error}`,
                    },
                });
            }
        });

        // スキル一覧取得イベント
        this.eventBus.subscribe('minebot:getInstantSkills', async (event) => {
            try {
                const formattedResponse = bot.instantSkills
                    .getSkills()
                    .map((skill) => {
                        const description = skill.description;
                        return `skillName: ${skill.skillName}, description: ${description}`;
                    })
                    .join('\n');
                this.eventBus.publish({
                    type: `minebot:skillResult`,
                    memoryZone: 'minecraft',
                    data: {
                        success: true,
                        result: formattedResponse,
                    },
                });
            } catch (error) {
                this.eventBus.publish({
                    type: `minebot:skillResult`,
                    memoryZone: 'minecraft',
                    data: {
                        success: false,
                        result: `error: ${error}`,
                    },
                });
            }
        });

        console.log('✅ Skill control events registered');
    }
}

