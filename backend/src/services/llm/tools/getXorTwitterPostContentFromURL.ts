import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import axios from "axios";
import dotenv from 'dotenv';
dotenv.config();

export default class GetXorTwitterPostContentFromURLTool extends StructuredTool {
    name = 'get-x-or-twitter-post-content-from-url';
    description = 'X(Twitter)の投稿URLから内容を取得するツール。画像がある場合は画像のURLも取得するので、describeImageツールで画像の内容を取得してみてください';
    schema = z.object({
        url: z
            .string()
            .describe('取得したいX(Twitter)の投稿のURL。有効なURLを指定してください。'),
    });
    private apiKey: string;
    constructor() {
        super();
        this.apiKey = process.env.TWITTERAPI_IO_API_KEY || '';
    }

    private extractTweetId(url: string): string | null {
        const match = url.match(/status\/(\d+)/);
        return match ? match[1] : null;
    }

    private async fetchTweetContent(tweetId: string, apiKey: string) {
        const endpoint = "https://api.twitterapi.io/twitter/tweets";

        try {
            const options = {
                method: 'GET',
                headers: { 'X-API-Key': apiKey },
                params: { tweet_ids: tweetId }
            };

            const response = await axios.get(endpoint, options);
            const text = response.data.tweets?.[0]?.text;
            const createdAt = response.data.tweets?.[0]?.createdAt;
            const retweetCount = response.data.tweets?.[0]?.retweetCount;
            const replyCount = response.data.tweets?.[0]?.replyCount;
            const likeCount = response.data.tweets?.[0]?.likeCount;
            const authorId = response.data.tweets?.[0]?.author?.id;
            const authorName = response.data.tweets?.[0]?.author?.name;
            const mediaUrl = response.data.tweets?.[0]?.extendedEntities?.media?.[0]?.media_url_https;
            return {
                text,
                createdAt,
                retweetCount,
                replyCount,
                likeCount,
                authorId,
                authorName,
                mediaUrl
            };
        } catch (error: any) {
            console.error("API呼び出しエラー:", error.response?.data || error.message);
            throw error;
        }
    }

    async _call(data: z.infer<typeof this.schema>): Promise<string> {
        try {
            const url = data.url;
            const tweetId = this.extractTweetId(url);
            if (!tweetId) {
                return 'X(Twitter)の投稿URLを指定してください。';
            }

            console.log('get-x-or-twitter-post-content-from-url', tweetId);

            const response = await this.fetchTweetContent(tweetId, this.apiKey);

            return `X(Twitter)の投稿からコンテンツを取得しました。${JSON.stringify(response)} `;
        } catch (error) {
            console.error('get-x-or-twitter-post-content-from-url error:', error);
            return `An error occurred while getting content from X(Twitter): ${error}`;
        }
    }
} 