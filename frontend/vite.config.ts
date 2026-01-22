import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Shannon-prod用: ポートを3001に変更
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: true, // 全てのIPアドレスでリッスン
    port: mode === 'test' ? 13001 : 3001,
    strictPort: true, // 指定したポートが使用中の場合はエラーを出す
    // 許可するホストを追加
    proxy: {
      '/api': 'http://localhost:5001',
    },
    allowedHosts: ['sh4nnon.com', 'www.sh4nnon.com', 'localhost'],
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
    }
  },
  // ホスト設定を追加
  preview: {
    host: true,
    port: 3001,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
    }
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
