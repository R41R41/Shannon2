import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '../../../../../utils/logger.js';
import { CONFIG } from '../../../config/MinebotConfig.js';

const log = createLogger('Minebot:UpdatePlan');

/**
 * update-plan ツール (Minebot版)
 *
 * LLMが自発的に計画を立てたり更新するためのツール。
 * タスクの目標、戦略、サブタスクを設定し、UI Mod にHTTP送信する。
 *
 * FunctionCallingAgent のイテレーションループ内で、
 * LLMが「まず計画を立てよう」と判断した時に呼び出す。
 *
 * LLMサービス版との違い:
 * - EventBus ではなく HTTP POST で UI Mod に通知
 * - Discord/WebUI 通知なし（Minecraft内のUI Modのみ）
 */
export class UpdatePlanTool extends StructuredTool {
  name = 'update-plan';
  description =
    'Update the current task plan. Call this FIRST for complex tasks (3+ steps) to outline your approach. ' +
    'Update subtask statuses as you complete them. For simple tasks (1-2 steps), skip this tool.';

  schema = z.object({
    goal: z.string().describe('The main goal of the task'),
    strategy: z
      .string()
      .describe('Brief strategy to achieve the goal (one sentence)'),
    subtasks: z
      .array(
        z.object({
          id: z
            .string()
            .describe('Unique subtask ID (e.g. "st_1", "st_2")'),
          goal: z.string().describe('What this subtask achieves'),
          status: z
            .enum(['pending', 'in_progress', 'completed', 'error'])
            .describe('Current status of the subtask'),
          result: z
            .string()
            .optional()
            .describe('Result summary when completed'),
          failureReason: z
            .string()
            .optional()
            .describe('Error reason when failed'),
        }),
      )
      .describe('Ordered list of subtasks to complete the goal'),
  });

  // 最新の計画を保持（FunctionCallingAgent から参照可能）
  private _lastPlan: z.infer<typeof this.schema> | null = null;

  public get lastPlan() {
    return this._lastPlan;
  }

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    this._lastPlan = data;

    // UI Mod に計画を送信
    try {
      const response = await fetch(`${CONFIG.UI_MOD_BASE_URL}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({
          status: 'in_progress',
          goal: data.goal,
          strategy: data.strategy,
          hierarchicalSubTasks: data.subtasks.map((st) => ({
            id: st.id,
            goal: st.goal,
            status: st.status,
            result: st.result || null,
            failureReason: st.failureReason || null,
          })),
          currentSubTaskId:
            data.subtasks.find((st) => st.status === 'in_progress')?.id ||
            null,
        }),
      });
      if (!response.ok) {
        log.error(`UI Mod通知失敗: status=${response.status}`);
      }
    } catch (error) {
      log.warn(`UI Mod通知スキップ: ${(error as Error).message}`);
    }

    const subtaskSummary = data.subtasks
      .map((st) => `  ${st.status === 'completed' ? '✓' : st.status === 'in_progress' ? '→' : '□'} ${st.goal}`)
      .join('\n');

    log.info(`📋 Plan updated: "${data.goal}" (${data.subtasks.length} subtasks) ${subtaskSummary.replace(/\n/g, ' | ')}`, 'cyan');

    return `計画を更新しました: ${data.goal} (${data.subtasks.length}個のサブタスク)`;
  }
}
