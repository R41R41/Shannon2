import { CustomToolNode } from './customToolNode.js';

/**
 * Use Tool Node: ツール実行（CustomToolNodeのラッパー）
 * LLMは使用せず、純粋なツール実行のみ
 */
export class UseToolNode {
  private customToolNode: CustomToolNode;

  constructor(customToolNode: CustomToolNode) {
    this.customToolNode = customToolNode;
  }

  async invoke(state: any): Promise<any> {
    console.log('⚙️ UseToolNode: ツールを実行中...');
    const result = await this.customToolNode.invoke(state);
    console.log('✅ ツール実行完了');
    return result;
  }
}
