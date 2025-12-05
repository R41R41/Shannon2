import { CONFIG } from '../config/MinebotConfig.js';
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

        // Minecraftチャットに送信
        this.bot.chat(message);

        // UI Modのチャットタブにも反映させる
        this.notifyUIMod(message).catch(err => {
            console.error('Failed to notify UI Mod:', err.message);
        });

        return { success: true, result: `メッセージを送信しました: ${message}` };
    }

    /**
     * UI Modのチャットタブにボットのメッセージを通知
     */
    private async notifyUIMod(message: string): Promise<void> {
        try {
            const response = await fetch(`${CONFIG.UI_MOD_BASE_URL}/bot_chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });

            if (!response.ok) {
                console.warn(`UI Mod notification failed: ${response.status}`);
            }
        } catch (error) {
            // UI Modが起動していない場合など、エラーは無視
        }
    }
}

export default Chat;

