import { StructuredTool } from '@langchain/core/tools';
import { Vec3 } from 'vec3';
import { z, ZodObject } from 'zod';
import { CustomBot } from '../../../types.js';

/**
 * InstantSkillをLangChainのStructuredToolに変換するクラス
 * スキルのパラメータからzodスキーマを動的生成
 */
export class InstantSkillTool extends StructuredTool {
    name: string;
    description: string;
    schema: ZodObject<any>;
    private bot: CustomBot;

    constructor(skill: any, bot: CustomBot) {
        super();
        this.bot = bot;
        this.name = skill.skillName;
        this.description = skill.description;
        this.schema = this.buildSchema(skill.params || []);
    }

    /**
     * スキルパラメータからzodスキーマを構築
     */
    private buildSchema(params: any[]): ZodObject<any> {
        return z.object(
            Object.fromEntries(
                params.map((param: any) => {
                    let zodType = this.getZodType(param.type);
                    zodType = zodType.nullable();

                    if (param.default !== undefined) {
                        try {
                            zodType = (zodType as any).default(param.default);
                        } catch (error) {
                            console.error(`デフォルト値の設定に失敗: ${error}`);
                        }
                    }

                    zodType = zodType.describe(param.description || '');
                    return [param.name, zodType];
                })
            )
        );
    }

    /**
     * パラメータ型からzod型を取得
     */
    private getZodType(type: string): z.ZodTypeAny {
        switch (type) {
            case 'number':
                return z.number();
            case 'Vec3':
                return z.object({ x: z.number(), y: z.number(), z: z.number() });
            case 'boolean':
                return z.boolean();
            case 'string':
            default:
                return z.string();
        }
    }

    /**
     * スキルを実行
     */
    async _call(data: any): Promise<string> {
        const skill = this.bot.instantSkills.getSkill(this.name);
        if (!skill) {
            return `${this.name}スキルが存在しません。`;
        }

        console.log(`\x1b[32m${skill.skillName}を実行: ${JSON.stringify(data)}\x1b[0m`);

        try {
            const args = this.convertArgs(skill.params || [], data);
            const result = await skill.run(...args);

            return typeof result === 'string'
                ? result
                : `結果: ${result.success ? '成功' : '失敗'} 詳細: ${result.result}`;
        } catch (error) {
            console.error(`${this.name}スキル実行エラー:`, error);
            return `スキル実行エラー: ${error}`;
        }
    }

    /**
     * データをスキルの引数に変換
     */
    private convertArgs(params: any[], data: any): any[] {
        return params.map((param) => {
            const value = data[param.name];

            if (param.type === 'Vec3' && value) {
                return new Vec3(value.x, value.y, value.z);
            }
            if (param.type === 'boolean') {
                if (value === 'true') return true;
                if (value === 'false') return false;
            }
            return value;
        });
    }
}

