import { createLogger } from '../../../utils/logger.js';
import { CustomBot } from '../types.js';

const log = createLogger('Minebot:Chat');
export async function getChatResponse(
  bot: CustomBot,
  question: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      bot.chat(question);
      bot.chatMode = false;

      const responseListener = (username: string, message: string) => {
        if (username !== bot.username) {
          bot.removeListener('chat', responseListener);
          resolve(message);
          bot.chatMode = true;
        }
      };

      bot.on('chat', responseListener);

      setTimeout(() => {
        bot.removeListener('chat', responseListener);
        reject(new Error('No response'));
        bot.chatMode = true;
      }, 180000); // 3分間
    } catch (error) {
      log.error('getChatResponse failed', error);
      reject(error);
    }
  });
}
