# Shannon アーキテクチャドキュメント

システム全体の設計と実装詳細

---

## 📐 システム全体図

```
┌─────────────────────────────────────────────────────────┐
│                    Minecraft Server                      │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
    ┌────▼─────┐         ┌──────▼──────┐
    │ Minebot  │◄────────┤ ShannonUIMod│
    │(Backend) │  HTTP   │ (Frontend)  │
    └────┬─────┘  8082   └──────┬──────┘
         │                       │
    LangGraph                Packet
    TaskGraph             Communication
```

---

## 🔷 Backend アーキテクチャ

### LangGraph ベースのタスク実行フロー

```
┌──────────────┐
│ User Message │
└──────┬───────┘
       │
       ▼
┌──────────────┐     new_task
│ CentralAgent ├────────────┐
│ (gpt-4o-mini)│            │
└──────────────┘            │
                            ▼
                   ┌────────────────┐
                   │   TaskGraph    │
                   │   (LangGraph)  │
                   └────────┬───────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Understanding │  │   Planning    │  │   Execution   │
│     Node      │─►│     Node      │─►│     Node      │
│               │  │  (o1-mini)    │  │               │
└───────────────┘  └───────┬───────┘  └───────┬───────┘
                           │                   │
                           │                   ▼
                           │          ┌────────────────┐
                           │          │ CustomToolNode │
                           │          │ (42 skills)    │
                           │          └────────┬───────┘
                           │                   │
                           │     ┌─────────────┤
                           │     │ success     │ error
                           │     ▼             ▼
                   ┌───────┴───────┐  ┌───────────────┐
                   │  Reflection   │  │   Planning    │
                   │     Node      │  │   (replan)    │
                   └───────────────┘  └───────────────┘
```

### コンポーネント詳細

#### 1. CentralAgent (アクション判定)

```typescript
モデル: gpt-4o-mini
温度: 0.3
役割:
- ユーザーメッセージを受信
- new_task / feedback / stop を判定
- TaskCoordinator に委譲
```

#### 2. TaskCoordinator (タスク管理)

```typescript
役割:
- タスクの作成・停止
- フィードバック処理
- 緊急対応の管理
- タスクスタック機構
```

#### 3. TaskGraph (LangGraph)

```typescript
フレームワーク: LangGraph
ノード:
- UnderstandingNode: 状況理解
- PlanningNode: 戦略立案 (o1-mini)
- ExecutionNode: 実行管理
- ReflectionNode: 反省
```

#### 4. PlanningNode (戦略立案)

```typescript
モデル: o1-mini
温度: 1.0
入力:
- environmentState
- botStatus (position, health, food, inventory, equipment, conditions)
- goal, strategy, status, subTasks
- actionLog
- humanFeedback

出力:
- goal: 最終目標
- strategy: 戦略
- status: pending | in_progress | completed | error
- actionSequence: 原子的アクションの配列
- subTasks: サブタスクの配列
- emergencyResolved: 緊急状態解決フラグ
```

#### 5. CustomToolNode (スキル実行)

```typescript
役割:
- actionSequence を順次実行
- エラー時即座に中断
- 詳細なログ出力

処理フロー:
for action in actionSequence:
  try:
    result = await tool._call(args)
    if result.success == false:
      abort and return to planning
  catch error:
    abort and return to planning
```

---

## 🎨 Frontend アーキテクチャ

### Minecraft Mod 構造

```
ShannonUIMod
├─ UI Layer
│  ├─ UIScreen (メインUI)
│  ├─ UIRenderer (タブ別レンダリング)
│  └─ UIComponents (各種コンポーネント)
│
├─ Network Layer
│  ├─ BackendClient (HTTP通信)
│  ├─ PacketRegistry (パケット登録)
│  └─ Packet Classes (S2C/C2S)
│
├─ State Management
│  ├─ TaskTreeState
│  ├─ DetailedLogsState
│  ├─ ConstantSkillsState
│  └─ ChatState
│
└─ Error Handling
   └─ ModErrorHandler
```

### 通信フロー

```
Backend (8082)                Frontend (Mod)
     │                             │
     │◄──── HTTP POST ──────────┐  │
     │      /throw_item          │  │
     │      /skill_switch        │  │
     │      /chat_message        │  │
     │                           │  │
     ├───── HTTP POST ───────────►│
     │      /task                │  │
     │      /task_logs           │  │
     │      /constant_skills     │  │
     │      /chat                │  │
     │                           │  │
     │                        Packet│
     │                       (Websocket)
```

---

## 🚨 緊急対応システム

### タスクスタック機構

```
通常タスク実行中
    │
    ▼
ダメージ/窒息検知
    │
    ▼
BotEventHandler.handleEmergencyDamage()
    │
    ▼
TaskCoordinator.handleEmergencyDamage()
    │
    ▼
TaskGraph.interruptForEmergency()
    │
    ├─ 現在のタスクをスタックに保存
    └─ 緊急メッセージでタスク開始
    │
    ▼
PlanningNode (緊急プロンプト注入)
    │
    ├─ 情報収集（list-nearby-entities, get-bot-status）
    ├─ 逃走判断
    └─ 回復行動
    │
    ▼
emergencyResolved: true
    │
    ▼
TaskCoordinator.handleEmergencyResolved()
    │
    ▼
TaskGraph.resumePreviousTask()
    │
    └─ スタックから元タスクを復元
```

### 緊急プロンプトの条件注入

```typescript
// prompt.ts
const emergencyRules =
  state.isEmergency && this.emergencyPrompt ? this.emergencyPrompt : null;

const messages = [
  new SystemMessage(prompt),
  emergencyRules ? new SystemMessage(emergencyRules) : null, // 条件付き
  // ...
];
```

---

## 🔧 設定管理

### Backend: MinebotConfig.ts

```typescript
export class MinebotConfig {
  // LLM設定
  readonly CENTRAL_AGENT_MODEL = "gpt-4o-mini";
  readonly PLANNING_MODEL = "o1-mini";
  readonly TEMPERATURE_PLANNING = 1.0;

  // サーバー設定
  readonly MINEBOT_API_PORT = 8082;
  readonly UI_MOD_PORT = 8081;

  // タスク設定
  readonly MAX_RETRY_COUNT = 5;
  readonly MAX_RECENT_MESSAGES = 8;

  // ...
}

export const CONFIG = new MinebotConfig();
```

### Frontend: ModConfig.java

```java
public class ModConfig {
    public static final int BACKEND_PORT = 8082;
    public static final String BACKEND_HOST = "localhost";
    public static final int HTTP_SERVER_PORT = 8081;
    // ...
}
```

---

## 📦 型定義

### TaskState (LangGraph State)

```typescript
interface TaskState {
  taskId: string;
  userMessage?: string;
  environmentState?: any;
  botStatus?: {
    position: Vec3;
    health: number;
    maxHealth: number;
    food: number;
    maxFood: number;
    healthStatus: string;
    foodStatus: string;
    inventory: Array<{ name: string; count: number }>;
    equipment: {
      hand: string;
      offHand: string;
      head: string;
      chest: string;
      legs: string;
      feet: string;
    };
    conditions: {
      isInWater: boolean;
      isInLava: boolean;
      isOnGround: boolean;
      isCollidedVertically: boolean;
    };
  };
  taskTree?: TaskTreeState;
  messages: BaseMessage[];
  humanFeedback?: string;
  retryCount: number;
  isEmergency?: boolean;
  emergencyType?: string;
  resuming?: boolean;
}
```

### TaskTreeState (UI 表示用)

```typescript
interface TaskTreeState {
  goal: string;
  strategy: string;
  status: TaskStatus;
  actionSequence?: Array<{
    toolName: string;
    args: string; // JSON文字列
    expectedResult: string;
  }> | null;
  subTasks?: Array<{
    subTaskGoal: string;
    subTaskStrategy: string;
    subTaskStatus: TaskStatus;
    subTaskResult: string | null;
  }> | null;
}
```

---

## 🔄 プロンプト管理

### プロンプトの構造

```
backend/saves/prompts/minebot/
├─ planning.md        # 戦略立案プロンプト（243行）
└─ emergency.md       # 緊急対応プロンプト（33行、条件付き注入）
```

### プロンプト最適化の成果

```
Before: 401行
├─ Output Format: 50行
├─ 基本ルール: 40行
├─ emergencyResolved: 120行 ← 分離
├─ actionSequence説明: 70行
├─ Available Skills: 87行 ← 削除（動的生成と重複）
└─ Common Patterns: 70行 ← 削減

After: 243行
├─ Output Format: 50行
├─ 基本ルール: 40行
├─ emergencyResolved: 5行（簡略版、詳細は別ファイル）
├─ actionSequence説明: 70行
└─ Common Pattern: 15行（1つのみ）

削減率: 40%
```

---

## 🎯 エラーハンドリング

### 3 レベルのエラーハンドリング

#### レベル 1: 基本対応

```typescript
try {
  // 処理
} catch (error) {
  return { success: false, result: error.message };
}
```

#### レベル 2: 事前チェック

```typescript
// パラメータチェック
if (!itemName || typeof itemName !== "string") {
  return { success: false, result: "アイテム名が不正です" };
}

// 距離チェック
if (distance > 5) {
  return { success: false, result: "距離が遠すぎます（最大5ブロック）" };
}

// 条件チェック
if (this.bot.food < 6) {
  return { success: false, result: "空腹度が低すぎてスプリントできません" };
}
```

#### レベル 3: 詳細メッセージ

```typescript
return {
  success: false,
  result: `パスが見つかりません（${distance.toFixed(1)}m先）
理由の可能性:
- 障害物がある
- 高低差が大きい（±4ブロック以上）
- チャンクが未ロード
対処法: 別のルート、障害物除去、近づいてから再試行`,
};
```

---

## 📊 パフォーマンス

### LLM 呼び出し頻度（1 タスクあたり）

```
CentralAgent: 1-3回（判定）
PlanningNode: 3-10回（戦略立案）
ToolAgentNode: 0回（actionSequence使用時）
```

### トークン使用量（推定、1 タスクあたり）

```
CentralAgent:  100K入力 / 50K出力
PlanningNode:  500K入力 / 200K出力
```

### レスポンスタイム（推定）

```
CentralAgent:  0.5-1秒
PlanningNode:  3-4秒
Execution:     1-5秒（スキルによる）
```

---

## 🔐 セキュリティ

### 環境変数（必須）

```bash
OPENAI_API_KEY=sk-...
MINECRAFT_BOT_USER_NAME=bot_name
MINECRAFT_BOT_PASSWORD=password
```

### ポート設定

```
Backend API: 8082 (localhost)
UI Mod HTTP Server: 8081 (localhost)
Minecraft Server: 25565 (configurable)
```

---

## 📝 開発ガイド

### 新しいスキルの追加

```typescript
// 1. instantSkills/yourSkill.ts を作成
export class YourSkill extends InstantSkill {
  name = 'your-skill'
  description = 'スキルの説明'
  params: SkillParam[] = [...]

  async runImpl(args: string[]): Promise<SkillResult> {
    // 実装
  }
}

// 2. ビルド
cd backend && npm run build

// 3. 再起動
./start.sh --dev
```

### 新しい Node の追加

```typescript
// 1. nodes/YourNode.ts を作成
export class YourNode {
  async invoke(state: any): Promise<any> {
    // 実装
  }
}

// 2. taskGraph.ts で登録
graph.addNode('your_node', new YourNode(...))
```

### プロンプトの更新

```bash
# 1. backend/saves/prompts/minebot/planning.md を編集
# 2. commonをビルド
cd common && npm run build
# 3. backendをビルド
cd ../backend && npm run build
# 4. 再起動
cd .. && ./start.sh --dev
```

---

## 🚀 デプロイ

### 開発環境

```bash
# Backend起動
cd Shannon-dev
./start.sh --dev

# Minecraft + Mod起動
# Fabric 1.21.4 + ShannonUIMod
```

### 本番環境

```bash
# Backend
cd Shannon-dev/backend
npm run build
npm start

# Mod
# .jar ファイルを mods/ フォルダに配置
```

---

このアーキテクチャは保守性・拡張性・テスタビリティを重視して設計されています。
