import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

export default class GetBluePrintListTool extends StructuredTool {
  name = 'get-blueprint-list';
  description =
    '保存されている設計図（Blueprint）の一覧を取得するツールです。何か建築をする際は必ず既にそれの設計図が存在するか確認してください。';
  schema = z.object({}); // パラメータなし

  async _call(): Promise<string> {
    try {
      const architectureDir = path.join(
        process.cwd(),
        'saves',
        'minecraft',
        'architecture'
      );

      // ディレクトリが存在しない場合は空配列を返す
      if (!fs.existsSync(architectureDir)) {
        return '保存されている設計図はありません。';
      }

      // .jsonファイルの一覧を取得
      const files = fs
        .readdirSync(architectureDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace('.json', ''));

      if (files.length === 0) {
        return '保存されている設計図はありません。';
      }

      // 一覧を整形して返す
      return `保存されている設計図一覧:\n${files
        .map((name) => `- ${name}`)
        .join('\n')}`;
    } catch (error) {
      return `設計図一覧の取得に失敗しました: ${error}`;
    }
  }
}
