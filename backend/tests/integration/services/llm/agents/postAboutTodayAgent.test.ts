import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostAboutTodayAgent } from '../../../../../src/services/llm/agents/postAboutTodayAgent';

describe('PostAboutTodayAgent Integration', () => {
  const promptPath = path.join(process.cwd(), 'saves/prompts/about_today.md');
  let originalPrompt: string | null = null;

  // 元のプロンプトを保存
  beforeAll(() => {
    if (fs.existsSync(promptPath)) {
      originalPrompt = fs.readFileSync(promptPath, 'utf-8');
    }
  });

  it.skip('should create post with actual prompt file', async () => {
    const agent = await PostAboutTodayAgent.create();
    const result = await agent.createPost();
    console.log(result);
    expect(result).toContain('【今日は何の日？】');
  }, 30000); // 30秒に延長

  // テスト後に元のプロンプトを復元
  afterAll(() => {
    if (originalPrompt) {
      fs.writeFileSync(promptPath, originalPrompt);
    }
  });
});
