import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';

interface ActionItem {
  toolName: string;
  args: Record<string, any>;
  expectedResult: string;
}

/**
 * カスタムToolNode: 複数ツールの順次実行
 * 動的解決は行わない（PlanningNodeが完全に引数を指定する）
 */
export class CustomToolNode {
  private tools: Map<string, StructuredTool>;

  constructor(tools: StructuredTool[]) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  /**
   * ツールのスキーマ情報を取得（エラーメッセージ用）
   */
  private getToolSchemaInfo(tool: StructuredTool): string {
    try {
      const schema = tool.schema;
      if (schema && typeof schema === 'object' && '_def' in schema) {
        const def = (schema as any)._def;
        if (def.typeName === 'ZodObject' && def.shape) {
          const params = Object.keys(def.shape()).map(key => {
            const field = def.shape()[key];
            const desc = field?._def?.description || '';
            const isNullable = field?._def?.typeName === 'ZodNullable';
            const required = !isNullable && desc.includes('必須') ? '(必須)' : '(省略可)';
            return `${key}${required}: ${desc}`;
          });
          return params.join(' | ');
        }
      }
      return 'パラメータ情報なし';
    } catch {
      return 'パラメータ情報なし';
    }
  }

  /**
   * アクションを実行
   */
  private async executeAction(
    action: ActionItem,
    index: number,
    total: number
  ): Promise<{ success: boolean; message: ToolMessage; result: string }> {
    console.log(
      `\x1b[36m[${index + 1}/${total}] ${action.toolName}を実行中...\x1b[0m`
    );

    const tool = this.tools.get(action.toolName);
    if (!tool) {
      const errorMsg = `ツール ${action.toolName} が見つかりません`;
      console.error(`\x1b[31m${errorMsg}\x1b[0m`);
      return {
        success: false,
        result: errorMsg,
        message: new ToolMessage({
          content: errorMsg,
          tool_call_id: `call_${Date.now()}_${index}`,
          name: action.toolName,
        }),
      };
    }

    try {
      // _expectedResult などの内部フィールドを除去
      const cleanArgs = { ...action.args };
      delete cleanArgs._expectedResult;
      delete cleanArgs._dynamicResolve;

      console.log(`${action.toolName}を実行します。パラメータ：${JSON.stringify(cleanArgs)}`);

      const result = await tool.invoke(cleanArgs);
      console.log(`\x1b[32m✓ ${action.toolName} 成功: ${result}\x1b[0m`);

      // 結果が失敗を示している場合もエラーとして扱う
      const isError =
        typeof result === 'string' &&
        (result.includes('失敗') ||
          result.includes('エラー') ||
          result.includes('error'));

      if (isError) {
        console.warn(
          `\x1b[33m⚠ ${action.toolName} の結果が失敗を示しています\x1b[0m`
        );
      }

      return {
        success: !isError,
        result: typeof result === 'string' ? result : JSON.stringify(result),
        message: new ToolMessage({
          content: result,
          tool_call_id: `call_${Date.now()}_${index}`,
          name: action.toolName,
        }),
      };
    } catch (error) {
      // スキーマエラーの場合、スキルの引数情報を表示
      let errorMsg = `${action.toolName} 実行エラー`;

      if (error instanceof Error && error.message.includes('did not match expected schema')) {
        const paramsInfo = this.getToolSchemaInfo(tool);

        errorMsg = `${action.toolName}の引数が間違っています。` +
          `提供された引数: ${JSON.stringify(action.args)}。` +
          `このスキルの引数: ${paramsInfo}`;
      } else {
        errorMsg += `: ${error instanceof Error ? error.message : '不明なエラー'}`;
      }

      console.error(`\x1b[31m✗ ${errorMsg}\x1b[0m`);

      return {
        success: false,
        result: errorMsg,
        message: new ToolMessage({
          content: errorMsg,
          tool_call_id: `call_${Date.now()}_${index}`,
          name: action.toolName,
        }),
      };
    }
  }

  async invoke(state: any) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];

    if (!(lastMessage instanceof AIMessage)) {
      throw new Error('Last message must be an AIMessage');
    }

    const toolCalls = lastMessage.tool_calls || [];
    if (toolCalls.length === 0) {
      throw new Error('No tool calls found in AIMessage');
    }

    const toolMessages: ToolMessage[] = [];
    let hasError = false;
    let lastResult = '';

    // アクションを順番に実行
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const action: ActionItem = {
        toolName: toolCall.name,
        args: toolCall.args,
        expectedResult: toolCall.args?._expectedResult || '',
      };

      const { success, message, result } = await this.executeAction(
        action,
        i,
        toolCalls.length
      );

      toolMessages.push(message);
      lastResult = result;

      if (!success) {
        hasError = true;
        // 残りのアクションをスキップ
        if (i < toolCalls.length - 1) {
          console.log(`\x1b[33m残り${toolCalls.length - i - 1}個のアクションをスキップしました\x1b[0m`);
        }
        break;
      }
    }

    return {
      messages: toolMessages,
      lastToolResult: lastResult,
      hasError,
    };
  }
}
