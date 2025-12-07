/**
 * アクションのargs文字列をパースしてオブジェクトに変換
 */
export function parseActionArgs(
    args: any,
    expectedResult?: string
): Record<string, any> {
    const dynamicResolveArgs = { _dynamicResolve: true, _expectedResult: expectedResult };

    // null/undefined
    if (args === null || args === undefined) {
        return dynamicResolveArgs;
    }

    // 文字列の場合
    if (typeof args === 'string') {
        const trimmed = args.trim();

        // 無効な文字列パターン
        if (trimmed === '' || trimmed === 'null' || trimmed.startsWith(':')) {
            return dynamicResolveArgs;
        }

        try {
            // シングルクォートをダブルクォートに変換してパース
            const parsed = JSON.parse(trimmed.replace(/'/g, '"'));
            return parsed === null ? dynamicResolveArgs : parsed;
        } catch {
            return dynamicResolveArgs;
        }
    }

    // オブジェクトの場合
    if (typeof args === 'object') {
        return args === null ? dynamicResolveArgs : { ...args };
    }

    return dynamicResolveArgs;
}

/**
 * nextActionSequenceをtool_calls形式に変換
 */
export function convertToToolCalls(actionSequence: any[]): any[] {
    return actionSequence.map((action: any, index: number) => {
        const parsedArgs = parseActionArgs(action.args, action.expectedResult);

        // expectedResultを常に含める
        if (parsedArgs && typeof parsedArgs === 'object') {
            parsedArgs._expectedResult = action.expectedResult;
        }

        return {
            name: action.toolName,
            args: parsedArgs,
            id: `call_${Date.now()}_${index}`,
        };
    });
}

