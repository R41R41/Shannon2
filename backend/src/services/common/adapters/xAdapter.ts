/**
 * X (Twitter) Channel Adapter
 *
 * Converts X-native events (reply notifications, mention detection)
 * into RequestEnvelopes and dispatches ShannonActionPlans as tweets.
 */

import {
  RequestEnvelope,
  ShannonActionPlan,
  ChannelAdapter,
} from '@shannon/common';
import { createEnvelope } from './envelopeFactory.js';

/**
 * Shape of the data currently published by Twitter client
 * via eventBus as 'llm:post_twitter_reply' or similar events.
 */
export interface XNativeReplyEvent {
  replyId: string;
  text: string;
  authorName: string;
  authorId?: string;
  repliedTweet?: string;
  repliedTweetAuthorName?: string;
}

/**
 * Shape of a member tweet event (llm:respond_member_tweet).
 */
export interface XNativeMemberTweetEvent {
  tweetId: string;
  text: string;
  authorName: string;
  authorId: string;
  isQuoteRT?: boolean;
}

/** Callback for posting tweets back. */
export type XDispatchFn = (plan: ShannonActionPlan) => Promise<void>;

export class XAdapter
  implements ChannelAdapter<XNativeReplyEvent | XNativeMemberTweetEvent>
{
  readonly channel = 'x' as const;

  constructor(private dispatchFn?: XDispatchFn) {}

  setDispatch(fn: XDispatchFn): void {
    this.dispatchFn = fn;
  }

  toEnvelope(
    event: XNativeReplyEvent | XNativeMemberTweetEvent,
  ): RequestEnvelope {
    // Determine if this is a reply event or member tweet
    const isReply = 'replyId' in event;
    const tweetId = isReply
      ? (event as XNativeReplyEvent).replyId
      : (event as XNativeMemberTweetEvent).tweetId;

    const tags: string[] = ['public_post'];
    if (isReply) tags.push('reply');
    if ('isQuoteRT' in event && event.isQuoteRT) tags.push('quote_rt');

    return createEnvelope({
      channel: 'x',
      sourceUserId: event.authorId ?? event.authorName,
      sourceDisplayName: event.authorName,
      conversationId: `x:${tweetId}`,
      threadId: `x:${tweetId}`,
      text: event.text,
      tags,
      x: {
        tweetId,
        authorId: event.authorId ?? event.authorName,
        authorName: event.authorName,
        isReply,
        isQuote: 'isQuoteRT' in event && event.isQuoteRT,
      },
      metadata: {
        repliedTweet: isReply
          ? (event as XNativeReplyEvent).repliedTweet
          : undefined,
        legacyMemoryZone: 'twitter:post',
      },
    });
  }

  async dispatch(plan: ShannonActionPlan): Promise<void> {
    if (!this.dispatchFn) {
      throw new Error('XAdapter: dispatchFn not set');
    }
    await this.dispatchFn(plan);
  }
}
