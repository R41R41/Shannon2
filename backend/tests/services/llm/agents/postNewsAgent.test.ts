import { beforeEach, describe, expect, it } from 'vitest';
import { PostNewsAgent } from '../../../../src/services/llm/agents/postNewsAgent';

describe('PostNewsAgent', () => {
    let agent: PostNewsAgent;

    beforeEach(async () => {
        agent = await PostNewsAgent.create();
    });

    it('createPost()がテクノロジーニュースを含む文字列を返すこと', async () => {
        const result = await agent.createPost();
        console.log(result);
        expect(typeof result).toBe('string');
        expect(result).toContain('のAIニュース');
    }, 60000);
});
