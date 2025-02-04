import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: true, // 全てのIPアドレスでリッスン
    port: mode === 'test' ? 13000 : 3000,
    strictPort: true, // 指定したポートが使用中の場合はエラーを出す
    // 許可するホストを追加
    proxy: {
      '/api': 'http://localhost:5000',
    },
    allowedHosts: ['sh4nnon.com', 'www.sh4nnon.com', 'localhost'],
  },
  // ホスト設定を追加
  preview: {
    host: true,
    port: 3000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@common': path.resolve(__dirname, '../common/src'),
      '@common/*': path.resolve(__dirname, '../common/src/*'),
      'cronstrue/locales/ja': 'cronstrue/locales/ja.js',
    },
  },
}));
