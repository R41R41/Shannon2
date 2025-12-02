import { CustomBot, InstantSkill } from '../types.js';
import { SkillParam } from '../types/skillParams.js';

class Chat extends InstantSkill {
    skillName = 'chat';
    description = 'Minecraftのチャットにメッセージを送信します';
    params: SkillParam[] = [
        {
            name: 'message',
            type: 'string' as const,
            description: '送信するメッセージ',
            required: true,
        },
    ];
    isToolForLLM = true;

    constructor(bot: CustomBot) {
        super(bot);
    }

    async runImpl(message: string) {
        if (!message) {
            return { success: false, result: 'メッセージが指定されていません' };
        }
        this.bot.chat(message);
        return { success: true, result: `メッセージを送信しました: ${message}` };
    }
}

export default Chat;

