import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';

export default class SearchWeatherTool extends StructuredTool {
  name = 'search-weather';
  description = '天気検索ツール。天気を調べるときは必ず使用する。';
  schema = z.object({
    date: z.string().describe('検索したい日付（YYYY-MM-DD）'),
    location: z.string().describe('検索したい場所（日本語で指定）'),
  });

  constructor() {
    super();
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    try {
      return `bing-searchツールを使用して${data.location}の${data.date}の天気を検索し、以下の形式で返してください。\n
      ${data.date}の${data.location}の天気は～～～です。
      気温:△△-△△℃
      降水確率:△△-△△%
      天気の詳しい説明と、気の利いた一言`;
    } catch (error) {
      console.error('天気検索ツールエラー:', error);
      return `エラーが発生しました: ${error}`;
    }
  }
}
