import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';

interface ActionItem {
  toolName: string;
  args: Record<string, any>;
  expectedResult: string;
  onErrorAction?: 'abort' | 'retry' | 'skip' | 'fallback';
  fallbackSequence?: ActionItem[];
  retryCount?: number;
}

/**
 * カスタムToolNode: 複数ツールの順次実行とエラー時の即時中断、フォールバック機構をサポート
 */
export class CustomToolNode {
  private tools: Map<string, StructuredTool>;

  constructor(tools: StructuredTool[]) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  private async executeAction(
    action: ActionItem,
    index: number,
    total: number
  ): Promise<{ success: boolean; message: ToolMessage }> {
    console.log(
      `\x1b[36m[${index + 1}/${total}] ${action.toolName}を実行中...\x1b[0m`
    );

    const tool = this.tools.get(action.toolName);
    if (!tool) {
      const errorMsg = `ツール ${action.toolName} が見つかりません`;
      console.error(`\x1b[31m${errorMsg}\x1b[0m`);
      return {
        success: false,
        message: new ToolMessage({
          content: errorMsg,
          tool_call_id: `call_${Date.now()}_${index}`,
          name: action.toolName,
        }),
      };
    }

    try {
      const result = await tool.invoke(action.args);
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
        message: new ToolMessage({
          content: result,
          tool_call_id: `call_${Date.now()}_${index}`,
          name: action.toolName,
        }),
      };
    } catch (error) {
      const errorMsg = `${action.toolName} 実行エラー: ${
        error instanceof Error ? error.message : '不明なエラー'
      }`;
      console.error(`\x1b[31m✗ ${errorMsg}\x1b[0m`);

      return {
        success: false,
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
    let errorIndex = -1;

    // 複数のツールコールを順次実行
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const action: ActionItem = {
        toolName: toolCall.name,
        args: toolCall.args,
        expectedResult: '',
        onErrorAction: (toolCall.args as any).onErrorAction || 'abort',
        fallbackSequence: (toolCall.args as any).fallbackSequence,
        retryCount: (toolCall.args as any).retryCount || 0,
      };

      const result = await this.executeAction(action, i, toolCalls.length);
      toolMessages.push(result.message);

      if (!result.success) {
        hasError = true;
        errorIndex = i;

        // エラーアクションの処理
        const onErrorAction = action.onErrorAction || 'abort';

        if (onErrorAction === 'skip') {
          console.log(`\x1b[33m⚠ エラーをスキップして続行します\x1b[0m`);
          hasError = false; // スキップの場合はエラーフラグをクリア
          continue;
        } else if (onErrorAction === 'retry' && (action.retryCount || 0) < 3) {
          console.log(
            `\x1b[33m⚠ リトライします（${
              (action.retryCount || 0) + 1
            }/3回目）\x1b[0m`
          );
          action.retryCount = (action.retryCount || 0) + 1;
          i--; // インデックスを戻してリトライ
          continue;
        } else if (
          onErrorAction === 'fallback' &&
          action.fallbackSequence &&
          action.fallbackSequence.length > 0
        ) {
          console.log(`\x1b[33m⚠ フォールバックシーケンスを実行します\x1b[0m`);

          // フォールバックシーケンスを実行
          for (let j = 0; j < action.fallbackSequence.length; j++) {
            const fallbackAction = action.fallbackSequence[j];
            const fallbackResult = await this.executeAction(
              fallbackAction,
              j,
              action.fallbackSequence.length
            );
            toolMessages.push(fallbackResult.message);

            if (!fallbackResult.success) {
              console.error(`\x1b[31m✗ フォールバックも失敗しました\x1b[0m`);
              break; // フォールバックも失敗したら中断
            }
          }

          // フォールバックが成功したらエラーフラグをクリア
          hasError = false;
          continue;
        } else {
          // abort または他のエラーアクションは即座に中断
          break;
        }
      }
    }

    // エラーが発生した場合、残りのツールコールをスキップしたことを記録
    if (hasError && errorIndex < toolCalls.length - 1) {
      const skippedCount = toolCalls.length - errorIndex - 1;
      console.log(
        `\x1b[33m残り${skippedCount}個のアクションをスキップしました\x1b[0m`
      );

      // スキップされたツールの情報を追加
      const skippedTools = toolCalls
        .slice(errorIndex + 1)
        .map((tc) => tc.name)
        .join(', ');
      toolMessages.push(
        new ToolMessage({
          content: `エラーのため以下のアクションをスキップしました: ${skippedTools}`,
          tool_call_id: `skip_${Date.now()}`,
          name: 'system',
        })
      );
    }

    return { messages: toolMessages };
  }
}
