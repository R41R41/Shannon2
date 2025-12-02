# Shannon - Autonomous Minecraft AI Agent

LLMベースの自律型Minecraftエージェントシステム

---

## 📚 ドキュメント

メインドキュメント（これだけ読めばOK）:

- **[PROJECT_STATUS.md](./PROJECT_STATUS.md)** - プロジェクト現状と次のステップ
- **[SKILLS_REFERENCE.md](./SKILLS_REFERENCE.md)** - 42個のスキル一覧
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - システムアーキテクチャ詳細

古いドキュメント（参考用）:
- `docs/archive/` - 過去の計画書・レポート類

---

## 🚀 クイックスタート

### 環境変数設定
```bash
# .env
OPENAI_API_KEY=sk-...
MINECRAFT_BOT_USER_NAME=bot_name
MINECRAFT_BOT_PASSWORD=password
```

### Backend起動
```bash
cd Shannon-dev
./start.sh --dev
```

### Frontend (Minecraft Mod)
```
1. Fabric 1.21.4 をインストール
2. ShannonUIMod.jar を mods/ に配置
3. Minecraftを起動
4. サーバーに接続
5. 'L' キーでUI表示
```

---

## 🎯 主な機能

### 1. 自律タスク実行
```
「原木を10個集めて」
→ LLMが戦略立案 → 42個のスキルで実行 → 完了報告
```

### 2. 複雑な業務対応
```
✅ 素手から鉄インゴット入手（10フェーズ、60アクション）
✅ 夜の敵モブ対策（状況判断で3パターン）
✅ ネザーでブレイズロッド入手
```

### 3. 緊急対応システム
```
ダメージ/窒息検知
→ 現在のタスク中断・保存
→ LLMが緊急対応
→ 解決後に元タスク復帰
```

---

## 🏗️ システム構成

```
Backend (Node.js + TypeScript)
├─ LangGraph: タスク実行フロー
├─ 42個の原子的スキル
└─ LLM: o1-mini (Planning), gpt-4o (Tool Agent), gpt-4o-mini (Central Agent)

Frontend (Minecraft Mod - Fabric)
├─ リアルタイムUI表示
├─ HTTP通信 (Port 8081/8082)
└─ カスタムパケット通信
```

---

## 📊 実装状況

### ✅ 完了
- Phase 6 Backend リファクタリング
- Phase 7 Frontend リファクタリング
- 42個の原子的スキル実装
- 緊急対応システム
- プロンプト最適化（40%削減）

### 🔴 優先度: 高
- LLMモデル最新化（o3-mini, gpt-4.1 等）
- 実戦テスト

### 🟡 優先度: 中
- パフォーマンス最適化

### 🟢 優先度: 低
- 追加スキル（レッドストーン系等）
- 知識管理システム（必要になったら）

---

## 🛠️ 開発

### ビルド
```bash
# Common (型定義)
cd common && npm run build

# Backend
cd backend && npm run build

# Frontend
cd ShannonUIMod && ./gradlew build
```

### スキル追加
```typescript
// backend/src/services/minebot/instantSkills/yourSkill.ts
export class YourSkill extends InstantSkill {
  name = 'your-skill'
  description = 'スキルの説明'
  params: SkillParam[] = [...]
  
  async runImpl(args: string[]): Promise<SkillResult> {
    // 実装
    return { success: true, result: '成功' }
  }
}
```

---

## 📝 License

MIT

## 🤝 Contributing

Issues, PRs welcome!

---

**詳細は [PROJECT_STATUS.md](./PROJECT_STATUS.md) を参照してください。**
