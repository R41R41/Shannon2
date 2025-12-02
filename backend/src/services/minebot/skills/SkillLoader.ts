import fs from 'fs';
import { join } from 'path';
import { CONFIG } from '../config/MinebotConfig.js';
import { ConstantSkill, ConstantSkills, CustomBot, InstantSkill, InstantSkills } from '../types.js';
import { SkillLoadError } from '../types/index.js';

/**
 * SkillLoader
 * スキルの読み込みと初期化を担当
 */
export class SkillLoader {
    private instantSkillDir: string;
    private constantSkillDir: string;

    constructor() {
        this.instantSkillDir = CONFIG.INSTANT_SKILLS_DIR;
        this.constantSkillDir = CONFIG.CONSTANT_SKILLS_DIR;
    }

    /**
     * InstantSkillsを読み込む
     */
    async loadInstantSkills(bot: CustomBot): Promise<{ success: boolean; result: string; skills?: InstantSkills }> {
        try {
            console.log('📂 Loading instant skills from:', this.instantSkillDir);
            const instantSkills = new InstantSkills();
            const files = fs.readdirSync(this.instantSkillDir);

            for (const file of files) {
                try {
                    if (file.endsWith('.js')) {
                        const { default: skillClass } = await import(
                            join(this.instantSkillDir, file)
                        );
                        const skillInstance = new skillClass(bot) as InstantSkill;
                        instantSkills.addSkill(skillInstance);
                    }
                } catch (error) {
                    console.error(`❌ Failed to load skill from ${file}:`, error);
                    return {
                        success: false,
                        result: `${file}の読み込みに失敗しました: ${error}`,
                    };
                }
            }

            console.log(`✅ Loaded ${instantSkills.getSkills().length} instant skills`);
            return {
                success: true,
                result: 'instant skills loaded',
                skills: instantSkills,
            };
        } catch (error) {
            const skillError = new SkillLoadError('instant-skills', error as Error);
            console.error(skillError.toJSON());
            return { success: false, result: skillError.message };
        }
    }

    /**
     * ConstantSkillsを読み込む
     */
    async loadConstantSkills(bot: CustomBot): Promise<{ success: boolean; result: string; skills?: ConstantSkills }> {
        try {
            console.log('📂 Loading constant skills from:', this.constantSkillDir);
            const constantSkills = new ConstantSkills();
            const files = fs.readdirSync(this.constantSkillDir);

            for (const file of files) {
                try {
                    if (file.endsWith('.js')) {
                        const { default: skillClass } = await import(
                            join(this.constantSkillDir, file)
                        );
                        const skillInstance = new skillClass(bot) as ConstantSkill;
                        constantSkills.addSkill(skillInstance);
                    }
                } catch (error) {
                    const skillError = new SkillLoadError(file, error as Error);
                    console.error(skillError.toJSON());
                    return {
                        success: false,
                        result: skillError.message,
                    };
                }
            }

            console.log(`✅ Loaded ${constantSkills.getSkills().length} constant skills`);
            return {
                success: true,
                result: 'constant skills loaded',
                skills: constantSkills,
            };
        } catch (error) {
            const skillError = new SkillLoadError('constant-skills', error as Error);
            console.error(skillError.toJSON());
            return { success: false, result: skillError.message };
        }
    }

    /**
     * ConstantSkillsの保存された状態を読み込む
     */
    loadConstantSkillsState(): { skillName: string; status: boolean }[] {
        const jsonPath = CONFIG.CONSTANT_SKILLS_JSON;
        let savedSkills: { skillName: string; status: boolean }[] = [];

        try {
            if (fs.existsSync(jsonPath)) {
                const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
                savedSkills = JSON.parse(jsonContent);
                console.log(`✅ Loaded constant skills state from ${jsonPath}`);
            }
        } catch (error) {
            console.error('❌ Failed to load constantSkills.json:', error);
        }

        return savedSkills;
    }

    /**
     * ConstantSkillsの状態を保存
     */
    saveConstantSkillsState(skills: ConstantSkill[]): void {
        const jsonPath = CONFIG.CONSTANT_SKILLS_JSON;
        const skillsData = skills.map(skill => ({
            skillName: skill.skillName,
            status: skill.status,
        }));

        try {
            fs.writeFileSync(jsonPath, JSON.stringify(skillsData, null, 2));
            console.log(`✅ Saved constant skills state to ${jsonPath}`);
        } catch (error) {
            console.error('❌ Failed to save constantSkills.json:', error);
        }
    }
}

