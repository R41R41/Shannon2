import { EventBus } from './eventBus.js';

// シングルトンインスタンスを管理
let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus();
  }
  return eventBusInstance;
}

// クリーンアップ用（テスト時などに使用）
export function clearEventBus(): void {
  eventBusInstance = null;
}
