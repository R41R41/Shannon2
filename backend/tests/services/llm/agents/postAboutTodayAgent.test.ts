import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { PostAboutTodayAgent } from '../../../../src/services/llm/agents/postAboutTodayAgent';
import { loadPrompt } from '../../../../src/services/llm/config/prompts';
import { TaskGraph } from '../../../../src/services/llm/graph/taskGraph';

// モックの設定
vi.mock('../../../../src/services/llm/graph/taskGraph');
vi.mock('../../../../src/services/llm/config/prompts');

describe('PostAboutTodayAgent', () => {
  let agent: PostAboutTodayAgent;
  let mockLoadPrompt: Mock;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadPrompt = vi.mocked(loadPrompt);
    mockLoadPrompt.mockResolvedValue('test prompt');

    // TaskGraphのモックを正しく設定
    vi.mocked(TaskGraph).mockImplementation(
      () =>
        ({
          invoke: vi.fn().mockResolvedValue({
            messages: [{ content: 'テスト投稿内容' }],
          }),
          model: {},
          tools: [],
          toolNode: vi.fn(),
          graph: {},
        } as unknown as TaskGraph)
    );

    agent = await PostAboutTodayAgent.create();
  });

  it.skip('should create post successfully', async () => {
    const result = await agent.createPost();
    expect(result).toBe('【今日は何の日？】\nテスト投稿内容');
  });

  it.skip('should throw error when systemPrompt is not set', async () => {
    mockLoadPrompt.mockResolvedValue(null);
    await expect(PostAboutTodayAgent.create()).rejects.toThrow(
      'Failed to load about_today prompt'
    );
  });
});
