const InstantSkill = require('./instantSkill.js');

class UpdateConstantSkill extends InstantSkill {
    constructor(bot) {
        super(bot);
        this.skillName = "updateConstantSkill";
        this.description = "Constant Skillを更新します。";
        this.params = [
            {
                name: "skillName",
                type: "string",
                description: "更新するConstant Skillの名前"
            },
            {
                name: "key",
                type: "string",
                description: "更新するConstant Skillの変数名"
            },
            {
                name: "value",
                type: "string",
                description: "更新するConstant Skillの変数の値"
            },
        ];
    }

    /**
     * @param {string} skillName スキル名
     * @param {string} key 変更するスキルの変数名
     * @param {string} value 変更するスキルの変数の値
     */
    async run(skillName, key, value) {
        const skill = this.bot.constantSkills[skillName];
        if (skill === null) {
            return {"error": true, "result": "スキルが見つかりません"};
        }
        if (!(key in skill)) {
            return {"error": true, "result": `スキルに${key}というキーが存在しません`};
        }
        if (!isNaN(value)) {
            value = parseInt(value, 10);
        } else if (value === 'null') {
            value = null;
        } else if (value === 'true') {
            value = true;
        } else if (value === 'false') {
            value = false;
        }
        skill[key] = value;
        return {"error": false, "result": `Constant Skill ${skillName}の${key}を${value}に更新しました`};
    }
}

module.exports = UpdateConstantSkill;