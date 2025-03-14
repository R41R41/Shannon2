const InstantSkill = require('./instantSkill.js');

class DisplayConstantSkill extends InstantSkill {
    /**
     * @param {import('../types.js').CustomBot} bot
     */
    constructor(bot) {
        super(bot);
        this.skillName = 'display-constant-skill';
        this.description = 'Constant Skillを表示します。';
        this.params = [
            {
                name: 'skillName',
                type: 'string',
                description: '表示するConstant Skillの名前',
            },
        ];
    }

    /**
     * @param {string} skillName スキル名
     */
    async run(skillName) {
        try {
            const skill = this.bot.constantSkills[skillName];
            if (skill === null) {
                return { success: false, result: 'スキルが見つかりません' };
            }
            const skillVariables = Object.entries(skill);
            for (const [key, value] of skillVariables) {
                if (key === 'status' || key === 'bot' || key === 'params') {
                    continue;
                }
                const message = JSON.stringify({
                    text: `${key}=${value}`,
                    color: 'gray',
                    hoverEvent: {
                        action: 'show_text',
                        contents: `update ${key}`,
                    },
                    clickEvent: {
                        action: 'suggest_command',
                        value: `./update-instant-skill ${skillName} ${key} ?`,
                    },
                });
                await this.bot.chat(`/tellraw @a ${message}`);
            }
            return { success: true, result: 'Constant Skillの表示を行いました' };
        } catch (error) {
            return { success: false, result: `${error.message} in ${error.stack}` };
        }
    }
}

module.exports = DisplayConstantSkill;
