import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostFortuneAgent } from '../../../../../src/services/llm/agents/postFortuneAgent';

describe('PostFortuneAgent Integration', () => {
  const promptPath = path.join(process.cwd(), 'saves/prompts/fortune.md');
  let originalPrompt: string | null = null;

  beforeAll(() => {
    if (fs.existsSync(promptPath)) {
      originalPrompt = fs.readFileSync(promptPath, 'utf-8');
    }
  });

  it('should create fortune post', async () => {
    const agent = await PostFortuneAgent.create();
    const result = await agent.createPost();
    console.log(result);
    expect(result).toContain('【今日の運勢】');
  }, 30000);

  afterAll(() => {
    if (originalPrompt) {
      fs.writeFileSync(promptPath, originalPrompt);
    }
  });
});
