/**
 * migrate-mongo 設定ファイル
 *
 * 使い方:
 *   npx migrate-mongo create <name>  — 新しいマイグレーション作成
 *   npx migrate-mongo up             — 未適用のマイグレーションを実行
 *   npx migrate-mongo down           — 最後のマイグレーションをロールバック
 *   npx migrate-mongo status         — マイグレーション状態を表示
 */
import dotenv from 'dotenv';
dotenv.config();

const config = {
  mongodb: {
    url: process.env.MONGODB_URI || 'mongodb://localhost:27017/shannon', // pragma: allowlist secret
    options: {},
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'esm',
};

export default config;
