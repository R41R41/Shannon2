import { useEffect, useState } from 'react';
import { ConnectionStatus, WebSocketClientBase } from '@/services/common/WebSocketClient';

/**
 * Agent の WebSocket 接続状態を監視するカスタムフック。
 * addStatusListener/removeStatusListener のボイラープレートを1行に削減する。
 */
export function useConnectionStatus(
  agent: WebSocketClientBase | null | undefined,
): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(
    agent?.getStatus() ?? 'disconnected',
  );

  useEffect(() => {
    if (!agent) return;
    setStatus(agent.getStatus());
    agent.addStatusListener(setStatus);
    return () => agent.removeStatusListener(setStatus);
  }, [agent]);

  return status;
}
