import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export default class WaitTool extends StructuredTool {
  name = 'wait';
  description =
    '指定された秒数だけ待機するツール。実際に待機する時間から5秒引いた秒数を設定してください。待機時間が5秒以下の場合はこのtoolを使用する必要はありません。';
  schema = z.object({
    seconds: z
      .number()
      .describe(
        '待機する秒数。実際に待機する時間から5秒引いた秒数を設定してください。例えば1分待機する場合は55(60秒-5秒)を設定してください。'
      ),
  });

  constructor() {
    super();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      console.log(`wait for ${data.seconds} seconds`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000 * (data.seconds ?? 1));
        const cleanup = () => {
          clearTimeout(timer);
          reject(new Error('Wait interrupted'));
        };

        // プロセス終了イベントをリッスン
        process.once('SIGTERM', cleanup);
        process.once('SIGINT', cleanup);

        // クリーンアップ関数を返して、プロミス完了時にイベントリスナーを削除
        return () => {
          process.off('SIGTERM', cleanup);
          process.off('SIGINT', cleanup);
        };
      });
      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      return `${currentTime} 待機しました: ${data.seconds}秒`;
    } catch (error) {
      console.error('Wait error:', error);
      return `待機中にエラーが発生しました: ${error}`;
    }
  }
}
