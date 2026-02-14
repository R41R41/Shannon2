import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import axios, { isAxiosError } from "axios";
import { getEventBus } from '../../eventBus/index.js';
import { EventBus } from '../../eventBus/eventBus.js';
import { TwitterClientOutput, TwitterClientInput } from '@shannon/common';
import { config } from '../../../config/env.js';

export default class GetXorTwitterPostContentFromURLTool extends StructuredTool {
    name = 'get-x-or-twitter-post-content-from-url';
    description = 'X(Twitter)の投稿URLから内容を取得するツール。画像がある場合は画像のURLも取得するので、必ずdescribeImageツールで画像の内容を取得してください';
    schema = z.object({
        url: z
            .string()
            .describe('取得したいX(Twitter)の投稿のURL。有効なURLを指定してください。'),
    });
    private apiKey: string;
    private eventBus: EventBus;
    constructor() {
        super();
        this.eventBus = getEventBus();
        this.apiKey = config.twitter.twitterApiIoKey;
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
        } catch (error: unknown) {
            const errMsg = isAxiosError(error)
                ? (error.response?.data ?? error.message)
                : error instanceof Error ? error.message : String(error);
            console.error("API呼び出しエラー:", errMsg);
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

            const getContent = new Promise<TwitterClientOutput>(async (resolve) => {
                this.eventBus.subscribe('tool:get_tweet_content', (event) => {
                    const { text, createdAt, retweetCount, replyCount, likeCount, authorId, authorName, mediaUrl } = event.data as TwitterClientOutput;
                    resolve({ text, createdAt, retweetCount, replyCount, likeCount, authorId, authorName, mediaUrl });
                });
                await this.eventBus.publish({
                    type: 'twitter:get_tweet_content',
                    memoryZone: 'twitter:get',
                    data: {
                        tweetId: tweetId,
                    } as TwitterClientInput,
                });
            });
            const response = await getContent;

            return `X(Twitter)の投稿からコンテンツを取得しました。${JSON.stringify(response)} `;
        } catch (error) {
            console.error('get-x-or-twitter-post-content-from-url error:', error);
            return `An error occurred while getting content from X(Twitter): ${error}`;
        }
    }
} 