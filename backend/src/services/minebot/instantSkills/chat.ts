import { CustomBot, InstantSkill } from '../types.js';

class Chat extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'chat';
    this.description =
      'チャット欄にテキストを送信します。ユーザーとの会話や、タスクの実行結果を伝える際、コマンドを実行する際に使用します。';
    this.priority = 50;
    this.params = [
      {
        name: 'text',
        type: 'string',
        description:
          'チャットするテキストを指定します。会話は基本的に日本語を指定してください。',
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
