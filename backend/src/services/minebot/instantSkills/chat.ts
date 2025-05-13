import { CustomBot, InstantSkill } from '../types.js';

class Chat extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'chat';
    this.description = 'チャット欄にテキストを送信します。';
    this.priority = 50;
    this.params = [
      {
        name: 'text',
        type: 'string',
        description: 'チャットするテキストを指定します。',
        default: null,
      },
    ];
  }

  async run(text: string) {
    console.log('chat', text);
    if (text === null) {
      return { success: false, result: 'テキストが指定されていません' };
    } else {
      this.bot.chat(text);
      return { success: true, result: `${text}とチャットしました` };
    }
  }
}

export default Chat;
