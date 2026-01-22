import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Minebot設定の一元管理クラス
 * 全ての設定値を1箇所で管理し、変更を容易にする
 */
export class MinebotConfig {
  // ===== LLM設定 =====

  /** CentralAgent用モデル（アクション判定） */
  readonly CENTRAL_AGENT_MODEL = 'gpt-4.1-mini';

  /** Planning用モデル */
  readonly PLANNING_MODEL = 'gpt-4o';

  /** Execution用モデル */
  readonly EXECUTION_MODEL = 'gpt-4o';

  /** Understanding用モデル */
  readonly UNDERSTANDING_MODEL = 'gpt-4o';

  /** Reflection用モデル */
  readonly REFLECTION_MODEL = 'gpt-4o';

  /** Planning時の温度パラメータ（創造性重視） */
  readonly TEMPERATURE_PLANNING = 1.0;

  /** Execution時の温度パラメータ（確実性重視） */
  readonly TEMPERATURE_EXECUTION = 0.1;

  /** CentralAgent時の温度パラメータ */
  readonly TEMPERATURE_CENTRAL = 0.3;

  // ===== サーバー設定 =====

  /** MinebotのAPIサーバーポート */
  readonly MINEBOT_API_PORT = 8092;

  /** UI Modのサーバーポート */
  readonly UI_MOD_PORT = 8091;

  /** UI Mod クライアントサイドHTTPサーバーのポート（スクリーンショット用） */
  readonly UI_MOD_CLIENT_PORT = 8093;

  /** UI Modのサーバーホスト */
  readonly UI_MOD_HOST = process.env.UI_MOD_HOST || 'localhost';

  /** UI ModサーバーのベースURL */
  get UI_MOD_BASE_URL(): string {
    return `http://${this.UI_MOD_HOST}:${this.UI_MOD_PORT}`;
  }

  /** UI Mod クライアントサーバーのベースURL（スクリーンショット用） */
  get UI_MOD_CLIENT_BASE_URL(): string {
    return `http://${this.UI_MOD_HOST}:${this.UI_MOD_CLIENT_PORT}`;
  }

  // ===== パス設定 =====

  /** プロンプトディレクトリ */
  readonly PROMPTS_DIR = join(__dirname, '../../../../saves/prompts');

  /** InstantSkillsディレクトリ */
  readonly INSTANT_SKILLS_DIR = join(__dirname, '../instantSkills');

  /** ConstantSkillsディレクトリ */
  readonly CONSTANT_SKILLS_DIR = join(__dirname, '../constantSkills');

  /** ConstantSkills状態保存JSON */
  readonly CONSTANT_SKILLS_JSON = join(
    __dirname,
    '../../../../saves/minecraft/constantSkills.json'
  );

  // ===== タスク設定 =====

  /** 最大リトライ回数 */
  readonly MAX_RETRY_COUNT = 10;

  /** タスクタイムアウト（ミリ秒） */
  readonly TASK_TIMEOUT = 10000;

  /** タスクキューの最大サイズ */
  readonly MAX_QUEUE_SIZE = 10;

  /** LangGraphの再帰制限 */
  readonly LANGGRAPH_RECURSION_LIMIT = 64;

  // ===== ログ設定 =====

  /** 保持する最大ログ数 */
  readonly MAX_LOGS = 200;

  /** プロンプトに含める最新メッセージ数 */
  readonly MAX_RECENT_MESSAGES = 5; // 8→5に削減（最新の結果だけで十分）

  /** エラーメッセージの最大保持数 */
  readonly MAX_ERROR_MESSAGES = 5;

  // ===== Minecraft接続設定 =====

  /** サーバー名とポートのマッピング */
  readonly MINECRAFT_SERVERS: Record<string, number> = {
    '1.21.4-test': 25566,
    '1.19.0-youtube': 25564,
    '1.21.1-play': 25565,
  };

  /** チェックタイムアウト間隔（ミリ秒） */
  readonly CHECK_TIMEOUT_INTERVAL = 60 * 60 * 1000; // 1時間

  // ===== 定期実行間隔 =====

  /** 100ms間隔タスク */
  readonly INTERVAL_100MS = 100;

  /** 1秒間隔タスク */
  readonly INTERVAL_1000MS = 1000;

  /** 5秒間隔タスク */
  readonly INTERVAL_5000MS = 5000;

  // ===== UI送信設定 =====

  /** UI Modに送信するログ数 */
  readonly UI_LOG_COUNT = 50;

  /** UI Modに送信する最新ログ数 */
  readonly UI_RECENT_LOG_COUNT = 100;

  // ===== エラー処理設定 =====

  /** エラー判定キーワード */
  readonly ERROR_KEYWORDS = ['エラー', '失敗', 'スキップ', 'error', 'failed'];

  // ===== 環境変数の取得とバリデーション =====

  /** OpenAI API Key */
  get OPENAI_API_KEY(): string {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    return key;
  }

  /** Minecraft Bot Username */
  get MINECRAFT_BOT_USER_NAME(): string {
    const username = process.env.MINECRAFT_BOT_USER_NAME;
    if (!username) {
      throw new Error(
        'MINECRAFT_BOT_USER_NAME environment variable is required'
      );
    }
    return username;
  }

  /** Minecraft Bot Password */
  get MINECRAFT_BOT_PASSWORD(): string {
    const password = process.env.MINECRAFT_BOT_PASSWORD;
    if (!password) {
      throw new Error(
        'MINECRAFT_BOT_PASSWORD environment variable is required'
      );
    }
    return password;
  }

  /** 開発モードかどうか */
  get IS_DEV(): boolean {
    return process.env.IS_DEV === 'True' || process.argv[3] === 'dev';
  }

  /**
   * 環境変数の検証
   * アプリケーション起動時に呼び出して、必要な環境変数が設定されているか確認
   */
  validateEnvironment(): void {
    const missingVars: string[] = [];

    try {
      this.OPENAI_API_KEY;
    } catch {
      missingVars.push('OPENAI_API_KEY');
    }

    try {
      this.MINECRAFT_BOT_USER_NAME;
    } catch {
      missingVars.push('MINECRAFT_BOT_USER_NAME');
    }

    try {
      this.MINECRAFT_BOT_PASSWORD;
    } catch {
      missingVars.push('MINECRAFT_BOT_PASSWORD');
    }

    if (missingVars.length > 0) {
      const error = new Error(
        `Missing required environment variables: ${missingVars.join(', ')}`
      );
      console.error('❌ Environment validation failed:', error.message);
      throw error;
    }

    console.log('✅ All required environment variables are set');
  }

  /**
   * 設定値のサマリーを表示（デバッグ用）
   */
  logConfiguration(): void {
    console.log('📋 Minebot Configuration:');
    console.log(`  LLM Models:`);
    console.log(`    - Central Agent: ${this.CENTRAL_AGENT_MODEL}`);
    console.log(`    - Planning: ${this.PLANNING_MODEL}`);
    console.log(`    - Execution: ${this.EXECUTION_MODEL}`);
    console.log(`  Server Ports:`);
    console.log(`    - Minebot API: ${this.MINEBOT_API_PORT}`);
    console.log(`    - UI Mod: ${this.UI_MOD_PORT}`);
    console.log(`  Task Settings:`);
    console.log(`    - Max Retry: ${this.MAX_RETRY_COUNT}`);
    console.log(`    - Task Timeout: ${this.TASK_TIMEOUT}ms`);
    console.log(`    - Max Queue Size: ${this.MAX_QUEUE_SIZE}`);
    console.log(`  Dev Mode: ${this.IS_DEV}`);
  }
}

// シングルトンインスタンスをエクスポート
export const CONFIG = new MinebotConfig();
