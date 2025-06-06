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
          'チャットするテキストを指定します。会話は基本的に日本語を指定してください。コマンドを実行する際は_/の後にコマンドを続けてください。（例：_/say テスト）',
        default: null,
      },
    ];
  }

  async runImpl(text: string) {
    console.log('chat input:', text);
    if (text === null) {
      return { success: false, result: 'テキストが指定されていません' };
    } else {
      try {
        // //で始まる場合は/を1つ削除（タスクグラフのエスケープ処理対応）
        if (text.startsWith('_/')) {
          text = text.slice(1);
          console.log('chat (_/ processed):', text);
        }

        await this.bot.chat(text);

        if (text.startsWith('/')) {
          return { success: true, result: `コマンド "${text}" を実行しました` };
        } else {
          return { success: true, result: `${text} とチャットしました` };
        }
      } catch (error: any) {
        return {
          success: false,
          result: `チャット送信エラー: ${error.message}`,
        };
      }
    }
  }
}

export default Chat;
