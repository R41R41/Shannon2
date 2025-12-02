/**
 * CentralAgent (旧実装 - 後方互換性のため残す)
 * 
 * ⚠️ 非推奨: 新しいコードでは TaskCoordinator を使用してください
 * 
 * このクラスは後方互換性のために残されていますが、
 * 実際の処理は TaskCoordinator に委譲されます。
 */

import { BaseMessage } from '@langchain/core/messages';
import { CustomBot } from '../../types.js';
import { TaskCoordinator } from '../agents/index.js';
import { TaskGraph } from './taskGraph.js';

export class CentralAgent {
  private static instance: CentralAgent;
  private taskCoordinator: TaskCoordinator;

  private constructor(bot: CustomBot) {
    this.taskCoordinator = new TaskCoordinator(bot);
    console.log(`🤖 CentralAgent initialized (delegating to TaskCoordinator)`);
  }

  public static getInstance(bot: CustomBot) {
    if (!CentralAgent.instance) {
      CentralAgent.instance = new CentralAgent(bot);
    }
    return CentralAgent.instance;
  }

  public async initialize() {
    await this.taskCoordinator.initialize();
  }

  public get currentTaskGraph(): TaskGraph | null {
    return this.taskCoordinator.getTaskGraph();
  }

  // プレイヤー発言を処理 (TaskCoordinatorに委譲)
  public async handlePlayerMessage(
    userName: string,
    message: string,
    environmentState?: string,
    selfState?: string,
    recentMessages?: BaseMessage[]
  ) {
    await this.taskCoordinator.handlePlayerMessage(
      userName,
      message,
      environmentState,
      selfState,
      recentMessages
    );
  }

  // TaskCoordinatorを取得
  public getTaskCoordinator(): TaskCoordinator {
    return this.taskCoordinator;
  }
}
