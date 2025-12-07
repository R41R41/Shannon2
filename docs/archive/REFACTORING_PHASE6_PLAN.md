# Phase 6: 追加リファクタリング計画

## 目標
- skillAgent.tsの責任分離
- 設定の一元化
- 型定義の整理
- テスタビリティの向上

---

## 6.1: skillAgent.tsの分割

### 現状の問題
- 360行の巨大クラス
- 複数の責任を持つ（SRP違反）
  - HTTPサーバー管理
  - スキル管理
  - イベント管理
  - チャット処理

### 提案: 責任ごとにクラスを分割

#### 6.1.1 SkillLoader
**責任**: スキルの読み込みと初期化
```typescript
// services/minebot/skills/SkillLoader.ts
export class SkillLoader {
  async loadInstantSkills(bot: CustomBot): Promise<InstantSkills>
  async loadConstantSkills(bot: CustomBot): Promise<ConstantSkills>
  private async loadSkillsFromDirectory(dir: string, bot: CustomBot)
}
```

#### 6.1.2 SkillRegistrar
**責任**: スキルとEventBusの紐付け
```typescript
// services/minebot/skills/SkillRegistrar.ts
export class SkillRegistrar {
  registerInstantSkills(skills: InstantSkills, eventBus: EventBus)
  registerConstantSkills(skills: ConstantSkills, eventBus: EventBus)
}
```

#### 6.1.3 BotEventHandler
**責任**: Minecraftイベントの処理
```typescript
// services/minebot/events/BotEventHandler.ts
export class BotEventHandler {
  registerChatHandler(bot: CustomBot)
  registerEntitySpawn(bot: CustomBot)
  registerHealth(bot: CustomBot)
  registerBlockUpdate(bot: CustomBot)
  registerEntityMove(bot: CustomBot)
  registerBossbar(bot: CustomBot)
}
```

#### 6.1.4 MinebotHttpServer
**責任**: Express APIサーバー管理
```typescript
// services/minebot/http/MinebotHttpServer.ts
export class MinebotHttpServer {
  private app: Application
  private server: Server | null
  
  start(port: number)
  stop()
  registerEndpoints(bot: CustomBot)
}
```

#### 6.1.5 リファクタリング後のskillAgent.ts (100行以下)
```typescript
export class SkillAgent {
  private bot: CustomBot
  private eventBus: EventBus
  private skillLoader: SkillLoader
  private skillRegistrar: SkillRegistrar
  private eventHandler: BotEventHandler
  private httpServer: MinebotHttpServer
  private centralAgent: CentralAgent
  
  async initialize() {
    // スキル読み込み
    const instantSkills = await this.skillLoader.loadInstantSkills(this.bot)
    const constantSkills = await this.skillLoader.loadConstantSkills(this.bot)
    
    // EventBus登録
    this.skillRegistrar.registerInstantSkills(instantSkills, this.eventBus)
    this.skillRegistrar.registerConstantSkills(constantSkills, this.eventBus)
    
    // イベントハンドラ登録
    this.eventHandler.registerAll(this.bot)
    
    // HTTPサーバー起動
    this.httpServer.start(CONFIG.MINEBOT_API_PORT)
    
    // CentralAgent初期化
    await this.centralAgent.initialize()
  }
}
```

---

## 6.2: 設定の一元化

### 現状の問題
- モデル名: `centralAgent.ts`にハードコード
- ポート番号: `skillAgent.ts`, `client.ts`に分散
- パス: `prompts.ts`にハードコード

### 提案: Config管理クラス

```typescript
// services/minebot/config/MinebotConfig.ts
export class MinebotConfig {
  // LLM設定
  readonly CENTRAL_AGENT_MODEL = 'gpt-4.1-mini'
  readonly PLANNING_MODEL = 'gpt-4o'
  readonly EXECUTION_MODEL = 'gpt-4o'
  readonly TEMPERATURE_PLANNING = 1.0
  readonly TEMPERATURE_EXECUTION = 0.1
  
  // サーバー設定
  readonly MINEBOT_API_PORT = 8082
  readonly UI_MOD_PORT = 8081
  
  // パス設定
  readonly PROMPTS_DIR = join(__dirname, '../../../saves/prompts')
  readonly INSTANT_SKILLS_DIR = join(__dirname, '../instantSkills')
  readonly CONSTANT_SKILLS_DIR = join(__dirname, '../constantSkills')
  readonly CONSTANT_SKILLS_JSON = join(__dirname, '../../../saves/minecraft/constantSkills.json')
  
  // タスク設定
  readonly MAX_RETRY_COUNT = 8
  readonly TASK_TIMEOUT = 10000
  readonly MAX_QUEUE_SIZE = 10
  
  // ログ設定
  readonly MAX_LOGS = 200
  readonly MAX_RECENT_MESSAGES = 8
  
  // Minecraft接続設定
  readonly MINECRAFT_SERVERS = {
    '1.21.4-test': 25566,
    '1.19.0-youtube': 25564,
    '1.21.1-play': 25565,
  }
  
  // 環境変数のバリデーション
  validateEnvironment() {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required')
    if (!process.env.MINECRAFT_BOT_USER_NAME) throw new Error('MINECRAFT_BOT_USER_NAME required')
    if (!process.env.MINECRAFT_BOT_PASSWORD) throw new Error('MINECRAFT_BOT_PASSWORD required')
  }
}

export const CONFIG = new MinebotConfig()
```

### 使用例
```typescript
// centralAgent.ts
this.openai = new ChatOpenAI({
  modelName: CONFIG.CENTRAL_AGENT_MODEL,
  temperature: 0.3,
})

// prompts.ts
const path = join(CONFIG.PROMPTS_DIR, directoryName, `${promptType}.md`)

// skillAgent.ts
this.httpServer.start(CONFIG.MINEBOT_API_PORT)
```

---

## 6.3: 型定義の整理

### 現状の問題
- `types.ts`が2箇所に存在
- 型定義が分散

### 提案: 型定義の統合

```
services/minebot/
  ├─ types/
  │   ├─ index.ts           # 全型定義をexport
  │   ├─ bot.ts             # Bot関連型
  │   ├─ skills.ts          # Skill基底クラス・型
  │   ├─ skillParams.ts     # SkillParam型（既存）
  │   ├─ events.ts          # EventBus関連型
  │   └─ state.ts           # 環境・自己状態型
  └─ llm/
      └─ types/
          ├─ index.ts
          ├─ taskState.ts   # TaskState型（既存）
          └─ agents.ts      # Agent関連型
```

---

## 6.4: CentralAgentとTaskGraphの改善

### 現状の問題
- `centralAgent.ts`の`judgeAction`がシンプルすぎる
- システムプロンプトがハードコード

### 提案: Structured Outputでアクション判定

```typescript
// centralAgent.ts
import { z } from 'zod'

const ActionSchema = z.object({
  action: z.enum(['new_task', 'feedback', 'stop']),
  reasoning: z.string().describe('判定理由'),
  confidence: z.number().min(0).max(1).describe('判定の確信度'),
})

private async judgeAction(
  message: string,
  recentMessages: BaseMessage[]
): Promise<TaskAction> {
  const systemPrompt = await loadPrompt('action_judge', 'minebot')
  
  const structuredLLM = this.openai.withStructuredOutput(ActionSchema)
  
  const result = await structuredLLM.invoke([
    new SystemMessage(systemPrompt),
    new SystemMessage(`実行中のタスク: ${JSON.stringify(this.currentTaskGraph?.currentState?.taskTree)}`),
    ...recentMessages.slice(-5),
    new HumanMessage(message),
  ])
  
  console.log(`✅ アクション判定: ${result.action} (確信度: ${result.confidence})`)
  console.log(`理由: ${result.reasoning}`)
  
  return result.action
}
```

---

## 6.5: テスタビリティの向上

### 現状の問題
- 依存関係がハードコード
- ユニットテストが困難

### 提案: Dependency Injection

```typescript
// skillAgent.ts
export interface ISkillLoader {
  loadInstantSkills(bot: CustomBot): Promise<InstantSkills>
  loadConstantSkills(bot: CustomBot): Promise<ConstantSkills>
}

export interface IMinebotHttpServer {
  start(port: number): void
  stop(): void
}

export class SkillAgent {
  constructor(
    private bot: CustomBot,
    private eventBus: EventBus,
    private skillLoader: ISkillLoader = new SkillLoader(),
    private httpServer: IMinebotHttpServer = new MinebotHttpServer(),
    private centralAgent: CentralAgent = CentralAgent.getInstance(bot)
  ) {}
}

// テストでモックを注入可能
const mockLoader = {
  loadInstantSkills: jest.fn(),
  loadConstantSkills: jest.fn(),
}
const agent = new SkillAgent(bot, eventBus, mockLoader)
```

---

## 6.6: エラーハンドリングの統一

### 現状の問題
- エラーハンドリングが各所でバラバラ
- ログ出力の形式が統一されていない

### 提案: エラーハンドラクラス

```typescript
// services/minebot/errors/MinebotErrorHandler.ts
export class MinebotError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'MinebotError'
  }
}

export class MinebotErrorHandler {
  private static instance: MinebotErrorHandler
  private logger: Logger
  
  handleSkillError(error: Error, skillName: string) {
    this.logger.error(`Skill ${skillName} failed:`, error)
    // エラーメトリクスの記録、通知など
  }
  
  handleLLMError(error: Error, context: string) {
    this.logger.error(`LLM error in ${context}:`, error)
    // リトライロジック、フォールバックなど
  }
  
  handleHttpError(error: Error, endpoint: string) {
    this.logger.error(`HTTP error at ${endpoint}:`, error)
  }
}
```

---

## 実装優先順位

### 高優先度（すぐに実装すべき）
1. **6.2: 設定の一元化** - 保守性大幅向上、影響範囲小
2. **6.1: skillAgent.tsの分割** - 可読性・保守性向上

### 中優先度（次のマイルストーンで）
3. **6.3: 型定義の整理** - 型安全性向上
4. **6.4: CentralAgentの改善** - 判定精度向上

### 低優先度（必要に応じて）
5. **6.5: テスタビリティ** - 長期的な品質向上
6. **6.6: エラーハンドリング** - 運用時の安定性向上

---

## 期待される効果

### 保守性
- ファイル行数: 360行 → 各100行以下（4分割）
- 責任の明確化: 1クラス1責任

### 可読性
- 設定の一元管理: 変更箇所が明確
- 型定義の整理: import文の簡素化

### テスタビリティ
- DI導入: ユニットテスト可能
- モック作成容易

### 拡張性
- 新機能追加時の影響範囲最小化
- プラグイン的な拡張が可能

---

## リスクと対策

### リスク1: 既存機能の破壊
**対策**: 段階的リファクタリング、各Phase後の動作確認

### リスク2: 複雑性の増加
**対策**: 適切な抽象化レベルの維持、過度な分割を避ける

### リスク3: パフォーマンス劣化
**対策**: DIのオーバーヘッドを測定、必要に応じて最適化

