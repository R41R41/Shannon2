/**
 * ISkillLoader
 * スキルローダーのインターフェース定義
 */

import { ConstantSkill, ConstantSkills, CustomBot, InstantSkills } from '../types.js';

export interface ISkillLoader {
    /**
     * InstantSkillsを読み込む
     */
    loadInstantSkills(bot: CustomBot): Promise<{
        success: boolean;
        result: string;
        skills?: InstantSkills;
    }>;

    /**
     * ConstantSkillsを読み込む
     */
    loadConstantSkills(bot: CustomBot): Promise<{
        success: boolean;
        result: string;
        skills?: ConstantSkills;
    }>;

    /**
     * ConstantSkillsの保存された状態を読み込む
     */
    loadConstantSkillsState(): { skillName: string; status: boolean }[];

    /**
     * ConstantSkillsの状態を保存
     */
    saveConstantSkillsState(skills: ConstantSkill[]): void;
}

