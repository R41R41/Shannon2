import { MemoryPlatform } from '../models/PersonMemory.js';

/**
 * コアメンバー (アイマイラボ！) のエイリアスマッピング
 *
 * 公人として全プラットフォームで同一人物として扱う。
 * privacyZone の制限を受けない特別枠。
 */
export interface MemberAlias {
  /** 正規名 */
  canonicalName: string;
  /** 全プラットフォームでの表示名・ユーザー名 */
  aliases: string[];
  /** プラットフォーム → platformUserId */
  platformIds: Partial<Record<MemoryPlatform, string>>;
}

export const MEMBER_ALIASES: MemberAlias[] = [
  {
    canonicalName: 'ライ',
    aliases: ['ライ', 'らい博士', 'Rai1241', 'R4iR4i000', 'rai'],
    platformIds: {
      discord: '693399783095754762',
      twitter: 'R4iR4i000',
      minebot: 'Rai1241',
      // youtube: '<channel_id>', // TODO: YouTube channel ID を設定
    },
  },
  {
    canonicalName: 'ヤミー',
    aliases: ['ヤミー', 'yumyummy34', 'yummy'],
    platformIds: {
      discord: '571206398797684737',
      twitter: 'yumyummy34',
      // minebot: '<minecraft_name>',
      // youtube: '<channel_id>',
    },
  },
  {
    canonicalName: 'グリコ',
    aliases: ['グリコ', 'guriko8670', 'guriko'],
    platformIds: {
      discord: '558186221265240066',
      twitter: 'guriko8670',
      // minebot: '<minecraft_name>',
      // youtube: '<channel_id>',
    },
  },
];

/**
 * エイリアスから正規名を解決する
 * @returns 正規名、または見つからない場合は null
 */
export function resolveAlias(name: string): MemberAlias | null {
  const normalized = name.toLowerCase().trim();
  return (
    MEMBER_ALIASES.find((m) =>
      m.aliases.some((a) => a.toLowerCase() === normalized),
    ) ?? null
  );
}

/**
 * platformUserId からメンバーを逆引きする
 */
export function resolveMemberByPlatformId(
  platform: MemoryPlatform,
  platformUserId: string,
): MemberAlias | null {
  return (
    MEMBER_ALIASES.find((m) => m.platformIds[platform] === platformUserId) ??
    null
  );
}

/**
 * コアメンバーかどうか判定
 */
export function isCoreMember(name: string): boolean {
  return resolveAlias(name) !== null;
}
