import fetch from 'node-fetch';
import { CONFIG } from '../config/MinebotConfig.js';
import { CustomBot, InstantSkill } from '../types.js';

/**
 * MODから返される進捗データの型定義
 */
interface AdvancementFromMod {
  id: string;
  category: string;
  title: string;
  description: string;
  frame: string;
  done: boolean;
  progress: number;
  criteriaCompleted: number;
  criteriaTotal: number;
}

interface AdvancementsResponse {
  playerName: string;
  advancements: AdvancementFromMod[];
  error?: string;
}

/**
 * 進捗名の日本語マッピング（MODが英語名を返す場合のフォールバック）
 */
const ADVANCEMENT_NAMES_JA: Record<string, string> = {
  // ===== Minecraft (Story) =====
  'minecraft:story/root': 'マインクラフト',
  'minecraft:story/mine_stone': '石器時代',
  'minecraft:story/upgrade_tools': 'アップグレード',
  'minecraft:story/smelt_iron': '金属を手に入れる',
  'minecraft:story/obtain_armor': '装備せよ',
  'minecraft:story/lava_bucket': 'ホットスタッフ',
  'minecraft:story/iron_tools': '鉄のツルハシで決まり',
  'minecraft:story/deflect_arrow': 'おしまい！',
  'minecraft:story/form_obsidian': 'アイス・バケツ・チャレンジ',
  'minecraft:story/mine_diamond': 'ダイヤモンド！',
  'minecraft:story/enter_the_nether': 'さらなる深みへ',
  'minecraft:story/shiny_gear': 'ダイヤモンドで私を覆って',
  'minecraft:story/enchant_item': 'エンチャンター',
  'minecraft:story/cure_zombie_villager': 'ゾンビドクター',
  'minecraft:story/follow_ender_eye': 'アイ・スパイ',
  'minecraft:story/enter_the_end': 'おしまい？',

  // ===== 冒険 (Adventure) =====
  'minecraft:adventure/root': '冒険',
  'minecraft:adventure/kill_a_mob': 'モンスターハンター',
  'minecraft:adventure/kill_all_mobs': 'モンスター狩りの達人',
  'minecraft:adventure/adventuring_time': '冒険の時間',
  'minecraft:adventure/sleep_in_bed': 'おやすみなさい',
  'minecraft:adventure/shoot_arrow': '的を射る',
  'minecraft:adventure/trade': 'お得な取引だ！',
  'minecraft:adventure/trade_at_world_height': '星の取引',
  'minecraft:adventure/honey_block_slide': 'べとべとな状況',
  'minecraft:adventure/ol_betsy': 'おてんば',
  'minecraft:adventure/totem_of_undying': '死を超えて',
  'minecraft:adventure/summon_iron_golem': 'お手伝いさん',
  'minecraft:adventure/voluntary_exile': '自主退去',
  'minecraft:adventure/hero_of_the_village': '村の英雄',
  'minecraft:adventure/sniper_duel': 'スナイパー対決',
  'minecraft:adventure/bullseye': '的中',
  'minecraft:adventure/two_birds_one_arrow': '一石二鳥',
  'minecraft:adventure/whos_the_pillager_now': '略奪者は誰？',
  'minecraft:adventure/arbalistic': '超高速',
  'minecraft:adventure/fall_from_world_height': '洞窟と崖',
  'minecraft:adventure/craft_decorated_pot': '装飾壺を作ろう',
  'minecraft:adventure/salvage_sherd': '大切に掘り出す',
  'minecraft:adventure/read_power_of_chiseled_bookshelf': '知識の力',
  'minecraft:adventure/trim_with_any_armor_pattern': 'おしゃれ！',
  'minecraft:adventure/trim_with_all_exclusive_armor_patterns': 'おしゃれ上級者',
  'minecraft:adventure/spyglass_at_parrot': '鳥だ！',
  'minecraft:adventure/spyglass_at_ghast': 'ガストだ！',
  'minecraft:adventure/spyglass_at_dragon': '目が合ったのはドラゴン',
  'minecraft:adventure/lightning_rod_with_villager_no_fire': 'サージプロテクター',
  'minecraft:adventure/walk_on_powder_snow_with_leather_boots': '軽業',
  'minecraft:adventure/play_jukebox_in_meadows': '夢のメロディー',
  'minecraft:adventure/avoid_vibration': '忍び足',

  // ===== 農業 (Husbandry) =====
  'minecraft:husbandry/root': '農業',
  'minecraft:husbandry/plant_seed': '種だらけの場所',
  'minecraft:husbandry/breed_an_animal': 'コウノトリの贈り物',
  'minecraft:husbandry/balanced_diet': 'バランスの良い食事',
  'minecraft:husbandry/tame_an_animal': '永遠の親友となるだろう',
  'minecraft:husbandry/fishy_business': '生臭い仕事',
  'minecraft:husbandry/breed_all_animals': '二匹ずつ',
  'minecraft:husbandry/complete_catalogue': '猫大全集',
  'minecraft:husbandry/tactical_fishing': '戦術的漁業',
  'minecraft:husbandry/axolotl_in_a_bucket': 'かわいいのがいっぱい！',
  'minecraft:husbandry/kill_axolotl_target': 'ウーパールーパーとの友情',
  'minecraft:husbandry/make_a_sign_glow': '光る！',
  'minecraft:husbandry/ride_a_boat_with_a_goat': '何でもヤギと一緒',
  'minecraft:husbandry/silk_touch_nest': '養蜂家',
  'minecraft:husbandry/safely_harvest_honey': '蜂蜜を安全に採取する',
  'minecraft:husbandry/wax_on': 'ワックス・オン',
  'minecraft:husbandry/wax_off': 'ワックス・オフ',
  'minecraft:husbandry/froglights': 'フロッグライトで照らされた',
  'minecraft:husbandry/allay_deliver_item_to_player': 'アレイの配達',
  'minecraft:husbandry/allay_deliver_cake_to_note_block': 'ケーキを焼いた',
  'minecraft:husbandry/obtain_netherite_hoe': '冗談抜きの真剣勝負',
  'minecraft:husbandry/obtain_sniffer_egg': 'スニッファーの卵',
  'minecraft:husbandry/feed_snifflet': 'ちっちゃな旅路',
  'minecraft:husbandry/plant_any_sniffer_seed': '古代の種',
  'minecraft:husbandry/leash_all_frog_variants': 'カエルの友達',
  'minecraft:husbandry/whole_pack': '仲間全員',

  // ===== ネザー (Nether) =====
  'minecraft:nether/root': 'ネザー',
  'minecraft:nether/return_to_sender': '送り返す',
  'minecraft:nether/find_bastion': '戦争の獣',
  'minecraft:nether/obtain_ancient_debris': '残骸でカバー',
  'minecraft:nether/fast_travel': '亜空間バブル',
  'minecraft:nether/find_fortress': '恐ろしい要塞',
  'minecraft:nether/obtain_crying_obsidian': 'あの人はいま？',
  'minecraft:nether/distract_piglin': 'ああ、輝くものだ！',
  'minecraft:nether/ride_strider': 'この道をゆけば',
  'minecraft:nether/uneasy_alliance': '不安な同盟',
  'minecraft:nether/loot_bastion': '戦利品',
  'minecraft:nether/use_lodestone': '目指せ北極星',
  'minecraft:nether/netherite_armor': 'ネザライトの時代',
  'minecraft:nether/explore_nether': 'ホットな観光地',
  'minecraft:nether/summon_wither': '不安定な塔',
  'minecraft:nether/brew_potion': '街のお薬屋さん',
  'minecraft:nether/create_beacon': 'ビーコンの活性化',
  'minecraft:nether/all_potions': '猛烈なカクテル',
  'minecraft:nether/create_full_beacon': 'ビーコネーター',
  'minecraft:nether/all_effects': 'どうしてこうなった？',
  'minecraft:nether/charge_respawn_anchor': '寝る前じゃないけど',

  // ===== ジ・エンド (End) =====
  'minecraft:end/root': 'ジ・エンド',
  'minecraft:end/kill_dragon': 'エンダードラゴンを倒す',
  'minecraft:end/dragon_egg': 'ザ・ネクストジェネレーション',
  'minecraft:end/enter_end_gateway': '都市の向こう',
  'minecraft:end/respawn_dragon': 'おしまい...再び...',
  'minecraft:end/dragon_breath': 'これは何だろう？',
  'minecraft:end/find_end_city': '果ての果て',
  'minecraft:end/elytra': '空はどこまでも高く',
  'minecraft:end/levitate': '非公開スカイブロック',
};

/**
 * バニラカテゴリーの日本語名マッピング
 */
const CATEGORY_NAMES: Record<string, string> = {
  'minecraft:story': 'Minecraft（ストーリー）',
  'minecraft:adventure': '冒険',
  'minecraft:husbandry': '農業',
  'minecraft:nether': 'ネザー',
  'minecraft:end': 'ジ・エンド',
};

/**
 * カテゴリーの表示名を取得（バニラは日本語名、データパックはそのまま）
 */
function getCategoryDisplayName(category: string): string {
  return CATEGORY_NAMES[category] || category;
}

/**
 * 原子的スキル: マイクラの進捗（実績）の達成状況を取得
 * ShannonUIMod の /advancements エンドポイント経由でリアルタイムに取得
 */
class GetAdvancements extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-advancements';
    this.description =
      'プレイヤーのマイクラ進捗（実績）の達成状況を確認します。石器時代、アップグレードなどの進捗をカテゴリー別に表示します。';
    this.params = [
      {
        name: 'playerName',
        type: 'string',
        description:
          '進捗を確認するプレイヤー名（省略時はボット自身）',
        required: false,
        default: null,
      },
      {
        name: 'category',
        type: 'string',
        description:
          '表示するカテゴリー（minecraft:story/minecraft:adventure/minecraft:husbandry/minecraft:nether/minecraft:end/all）。データパックのカテゴリーも指定可能。省略時はall',
        required: false,
        default: 'all',
      },
    ];
  }

  /**
   * MODのエンドポイントから進捗データを取得
   */
  private async fetchAdvancementsFromMod(
    playerName?: string,
    category?: string
  ): Promise<AdvancementsResponse> {
    const params = new URLSearchParams();
    if (playerName) params.set('playerName', playerName);
    if (category && category !== 'all') params.set('category', category);

    const queryString = params.toString();
    const url = `${CONFIG.UI_MOD_BASE_URL}/advancements${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`MOD API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AdvancementsResponse;
  }

  /**
   * 進捗名を取得（日本語マッピング優先、なければMODからのタイトル）
   */
  private getAdvancementName(id: string, modTitle: string): string {
    return ADVANCEMENT_NAMES_JA[id] || modTitle;
  }

  /**
   * カテゴリー別に進捗をフォーマット
   * データパック追加の進捗も動的にカテゴリー分けして表示
   */
  private formatAdvancements(
    advancements: AdvancementFromMod[],
    filterCategory: string
  ): string {
    // 進捗データから登場するカテゴリーを動的に収集
    const categorySet = new Set<string>();
    for (const a of advancements) {
      categorySet.add(a.category);
    }

    // バニラカテゴリーを先に、データパックカテゴリーを後に表示
    const vanillaOrder: string[] = [
      'minecraft:story',
      'minecraft:adventure',
      'minecraft:husbandry',
      'minecraft:nether',
      'minecraft:end',
    ];
    const categories: string[] = [];

    if (filterCategory === 'all') {
      // バニラカテゴリーを順番通りに追加
      for (const vc of vanillaOrder) {
        if (categorySet.has(vc)) {
          categories.push(vc);
          categorySet.delete(vc);
        }
      }
      // 残りのデータパックカテゴリーをソートして追加
      const remaining = Array.from(categorySet).sort();
      categories.push(...remaining);
    } else {
      categories.push(filterCategory);
    }

    const results: string[] = [];

    for (const cat of categories) {
      const categoryAdvancements = advancements
        .filter((a) => a.category === cat)
        .map((a) => ({
          ...a,
          jaName: this.getAdvancementName(a.id, a.title),
        }));

      if (categoryAdvancements.length === 0) continue;

      // 完了/未完了でソート
      categoryAdvancements.sort((a, b) => {
        if (a.done === b.done) return 0;
        return a.done ? -1 : 1;
      });

      const doneCount = categoryAdvancements.filter((a) => a.done).length;
      const totalCount = categoryAdvancements.length;

      const displayName = getCategoryDisplayName(cat);
      const header = `【${displayName}】(${doneCount}/${totalCount} 達成)`;
      const items = categoryAdvancements.map((a) => {
        const status = a.done ? '✅' : '🔲';
        const progressInfo =
          !a.done && a.criteriaTotal > 1
            ? ` (${a.criteriaCompleted}/${a.criteriaTotal})`
            : '';
        return `  ${status} ${a.jaName}${progressInfo}`;
      });

      results.push(`${header}\n${items.join('\n')}`);
    }

    if (results.length === 0) {
      return '該当する進捗データがありません。';
    }

    return results.join('\n\n');
  }

  async runImpl(playerName?: string, category?: string) {
    try {
      const filterCategory = category || 'all';

      // MODから進捗データを取得
      const data = await this.fetchAdvancementsFromMod(
        playerName || undefined,
        filterCategory
      );

      // エラーチェック
      if (data.error) {
        return {
          success: false,
          result: data.error,
        };
      }

      // フォーマットして返す
      const formatted = this.formatAdvancements(
        data.advancements,
        filterCategory
      );
      const catLabel =
        filterCategory !== 'all'
          ? `（${getCategoryDisplayName(filterCategory)}）`
          : '';
      const header = `🏆 ${data.playerName} の進捗状況${catLabel}`;

      return {
        success: true,
        result: `${header}\n\n${formatted}`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `進捗取得エラー: ${error.message}`,
      };
    }
  }
}

export default GetAdvancements;
