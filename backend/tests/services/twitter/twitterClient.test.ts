import { describe, it, expect } from 'vitest';
import { TwitterClient } from '../../../src/services/twitter/client';

// .envに必要な値（APIキー、メール、パスワードなど）がセットされている前提

describe('TwitterClient', () => {
    it('should post a tweet with only text', async () => {
        const client = TwitterClient.getInstance(false);
        await client.start();
        // テスト用のtext
        const testText = 'テスト投稿 ' + Date.now();

        // postTweetはprivateなので、publicにするか、ラッパーを作るか、またはanyでアクセス
        // ここではanyでアクセス
        const result = await (client as any).postTweet(testText, null);
        // 成功すればエラーにならず、consoleに投稿IDが出る
        console.log(result);
        expect(result.status).toBe(200); // postTweetはreturn値なし
    });
});
