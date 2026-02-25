/**
 * WebSocket メッセージのランタイムバリデーション。
 * JSON.parse() 後のデータを型安全に検証する。
 */

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * 安全に JSON をパースし、最低限 { type: string } であることを検証する。
 * パース失敗や type 不在の場合は null を返す。
 */
export function parseMessage(raw: string): WebSocketMessage | null {
  try {
    const data = JSON.parse(raw);
    if (typeof data === 'object' && data !== null && typeof data.type === 'string') {
      return data as WebSocketMessage;
    }
    console.warn('[WS] Invalid message: missing "type" field', data);
    return null;
  } catch (err) {
    console.warn('[WS] Failed to parse message:', err);
    return null;
  }
}
