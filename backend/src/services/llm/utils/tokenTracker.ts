/**
 * LLM API 呼び出しのトークン使用量を記録する。
 * MongoDB が利用可能であれば永続化し、集計 API 用のデータを提供する。
 */
import mongoose from 'mongoose';
import { logger } from '../../../utils/logger.js';

interface TokenUsageEntry {
  timestamp: Date;
  model: string;
  service: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const TokenUsageSchema = new mongoose.Schema<TokenUsageEntry>({
  timestamp: { type: Date, default: Date.now, index: true },
  model: { type: String, required: true, index: true },
  service: { type: String, required: true, index: true },
  promptTokens: { type: Number, required: true },
  completionTokens: { type: Number, required: true },
  totalTokens: { type: Number, required: true },
});

TokenUsageSchema.index({ timestamp: -1 });
TokenUsageSchema.index({ service: 1, timestamp: -1 });

let TokenUsage: mongoose.Model<TokenUsageEntry>;
try {
  TokenUsage = mongoose.model<TokenUsageEntry>('TokenUsage');
} catch {
  TokenUsage = mongoose.model<TokenUsageEntry>('TokenUsage', TokenUsageSchema);
}

const inMemoryStats = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  callCount: 0,
  byModel: new Map<string, { prompt: number; completion: number; calls: number }>(),
  byService: new Map<string, { prompt: number; completion: number; calls: number }>(),
};

export const tokenTracker = {
  async record(
    model: string,
    service: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void> {
    const totalTokens = promptTokens + completionTokens;

    inMemoryStats.totalPromptTokens += promptTokens;
    inMemoryStats.totalCompletionTokens += completionTokens;
    inMemoryStats.totalTokens += totalTokens;
    inMemoryStats.callCount++;

    const modelStats = inMemoryStats.byModel.get(model) || { prompt: 0, completion: 0, calls: 0 };
    modelStats.prompt += promptTokens;
    modelStats.completion += completionTokens;
    modelStats.calls++;
    inMemoryStats.byModel.set(model, modelStats);

    const serviceStats = inMemoryStats.byService.get(service) || { prompt: 0, completion: 0, calls: 0 };
    serviceStats.prompt += promptTokens;
    serviceStats.completion += completionTokens;
    serviceStats.calls++;
    inMemoryStats.byService.set(service, serviceStats);

    try {
      if (mongoose.connection.readyState === 1) {
        await TokenUsage.create({
          timestamp: new Date(),
          model,
          service,
          promptTokens,
          completionTokens,
          totalTokens,
        });
      }
    } catch (err) {
      logger.debug(`[TokenTracker] MongoDB 保存スキップ: ${err}`);
    }
  },

  getSessionStats() {
    const byModel: Record<string, { prompt: number; completion: number; calls: number }> = {};
    for (const [k, v] of inMemoryStats.byModel) byModel[k] = v;

    const byService: Record<string, { prompt: number; completion: number; calls: number }> = {};
    for (const [k, v] of inMemoryStats.byService) byService[k] = v;

    return {
      totalPromptTokens: inMemoryStats.totalPromptTokens,
      totalCompletionTokens: inMemoryStats.totalCompletionTokens,
      totalTokens: inMemoryStats.totalTokens,
      callCount: inMemoryStats.callCount,
      byModel,
      byService,
    };
  },

  async getDailyStats(daysBack = 7): Promise<any[]> {
    if (mongoose.connection.readyState !== 1) return [];
    try {
      return TokenUsage.aggregate([
        { $match: { timestamp: { $gte: new Date(Date.now() - daysBack * 86400000) } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
              model: '$model',
            },
            totalTokens: { $sum: '$totalTokens' },
            promptTokens: { $sum: '$promptTokens' },
            completionTokens: { $sum: '$completionTokens' },
            calls: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': -1 } },
      ]);
    } catch {
      return [];
    }
  },
};
