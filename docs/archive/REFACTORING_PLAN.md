# Shannon 大規模リファクタリング計画

## 🎯 目的

現在の Shannon システム（minebot + ShannonUIMod）を以下の観点で改善：

1. **保守性**: コードの見通しを良くし、変更を容易にする
2. **拡張性**: 新機能追加が簡単になるアーキテクチャ
3. **テスタビリティ**: ユニットテストが書きやすい構造
4. **パフォーマンス**: 不要な処理を削減、最適化

---

## 📊 現状分析

### Backend (Shannon-dev/backend/src/services/minebot)

#### 🔴 問題点

1. **ノードの責務が不明確**
   - `TaskGraph`が全ノードの初期化と管理を担当（God Object 化）
   - `EnhancedExecutionNode`, `UnderstandingNode`, `ReflectionNode`が追加されたが、既存の`UseToolNode`, `ToolAgentNode`と責務が重複
2. **ログシステムが分散**

   - 各ノードが独自に`LogManager`を持つ
   - UI への送信が各所に散在
   - ログの一元管理ができていない

3. **状態管理の複雑さ**

   - `TaskState`の型定義が`taskGraph.ts`内に埋め込まれている
   - 状態の更新が各ノードで異なる方法で行われる

4. **LangGraph の利用が中途半端**

   - ハイブリッド型を目指したが、実際には旧システムと新システムが混在
   - `UseToolNode`と`EnhancedExecutionNode`が両方存在

5. **型安全性の不足**
   - `any`型が多用されている
   - スキルのパラメータ定義が実行時まで検証されない

#### 🟢 良い点

- 42 個の原子的スキルは良く設計されている
- EventBus によるサービス間通信は明確
- プロンプト管理が分離されている

### Frontend (ShannonUIMod)

#### 🔴 問題点

1. **UI レンダリングロジックの肥大化**

   - `UIRenderer.java`が 440 行で責務が多すぎる
   - 各タブのレンダラーが個別ファイルだが、共通処理が重複

2. **状態管理の問題**

   - 全ての状態が`ShannonUIMod.java`の static フィールド
   - 状態の更新が散在している

3. **パケット処理の冗長性**

   - 各 Packet に似たようなシリアライズ/デシリアライズ処理
   - 型安全性が低い

4. **HTTP サーバーの肥大化**
   - `ShannonUIMod.onInitialize()`内に HTTP エンドポイントが全て定義
   - 200 行以上のネストしたコード

#### 🟢 良い点

- タブベースの UI 設計は直感的
- パケット通信による同期は安定
- 軽量で動作が速い

---

## 🏗️ リファクタリング計画

### Phase 1: Backend - ノード構造の整理（優先度: 高）

#### 目標

LangGraph ベースの明確な責務分離

#### 作業内容

1. **ノードの統合と整理**

```typescript
// 新しい構造
backend/src/services/minebot/llm/graph/
├── nodes/
│   ├── UnderstandingNode.ts      // 状況理解（新）
│   ├── PlanningNode.ts            // 計画立案（既存、拡張）
│   ├── ExecutionNode.ts           // 実行（EnhancedExecutionNodeにリネーム＆統合）
│   ├── ReflectionNode.ts          // 反省（新）
│   └── index.ts
├── state/
│   ├── TaskState.ts               // 状態定義を分離
│   └── StateManager.ts            // 状態管理ロジック
├── logging/
│   ├── LogManager.ts              // 既存を移動
│   ├── LogSender.ts               // 既存を移動
│   └── index.ts
├── TaskGraph.ts                   // 軽量化
└── types.ts
```

2. **旧ノードの削除**

   - `UseToolNode.ts` → 削除（ExecutionNode に統合）
   - `ToolAgentNode.ts` → 削除（PlanningNode に統合）
   - `CustomToolNode.ts` → 簡素化、ExecutionNode 内に統合

3. **明確なグラフフロー**

```typescript
Understanding → Planning → Execution → Reflection
                   ↑            ↓
                   └────────────┘ (replan on error)
```

#### 期待効果

- コードの見通しが良くなる（各ノード 100-200 行）
- テストが書きやすくなる
- 新しいノードの追加が容易

---

### Phase 2: Backend - ログシステムの一元化（優先度: 高）

#### 目標

全てのログを`LogManager`で一元管理

#### 作業内容

1. **シングルトン LogManager の強化**

```typescript
// backend/src/services/minebot/llm/graph/logging/CentralLogManager.ts
export class CentralLogManager {
  private static instance: CentralLogManager;
  private logManagers: Map<string, LogManager> = new Map();

  // 各ノード用のLogManagerを取得
  getLogManager(nodeId: string): LogManager {
    if (!this.logManagers.has(nodeId)) {
      this.logManagers.set(nodeId, new LogManager());
    }
    return this.logManagers.get(nodeId)!;
  }

  // 全ノードのログを集約
  getAllLogs(): DetailedLog[] {
    const allLogs: DetailedLog[] = [];
    for (const manager of this.logManagers.values()) {
      allLogs.push(...manager.getLogs());
    }
    return allLogs.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
  }

  // UIに一括送信
  async sendAllLogsToUI(goal: string): Promise<void> {
    const logs = this.getAllLogs();
    await fetch("http://localhost:8081/task_logs", {
      method: "POST",
      body: JSON.stringify({ goal, logs: logs.map(toUIFormat) }),
    });
  }
}
```

2. **各ノードの修正**

```typescript
// 各ノードはCentralLogManagerから自分用のLogManagerを取得
export class ExecutionNode {
  private logManager: LogManager;

  constructor(bot: CustomBot, centralLogManager: CentralLogManager) {
    this.logManager = centralLogManager.getLogManager("execution_node");
  }
}
```

#### 期待効果

- ログの送信タイミングを一元管理
- ノード間のログ順序が保証される
- デバッグが容易

---

### Phase 3: Frontend - 状態管理のリファクタリング（優先度: 中）

#### 目標

状態管理を`StateManager`クラスに集約

#### 作業内容

1. **StateManager の作成**

```java
// ShannonUIMod/src/main/java/com/shannon/state/StateManager.java
public class StateManager {
    private static StateManager instance;

    private TaskTreeState taskTreeState = new TaskTreeState();
    private DetailedLogsState logsState = new DetailedLogsState();
    private ConstantSkillsState skillsState = new ConstantSkillsState();
    private InventoryState inventoryState = new InventoryState();
    private ChatState chatState = new ChatState();

    private final List<StateChangeListener> listeners = new ArrayList<>();

    public static StateManager getInstance() {
        if (instance == null) {
            instance = new StateManager();
        }
        return instance;
    }

    public void updateTaskTreeState(TaskTreeState newState) {
        this.taskTreeState = newState;
        notifyListeners(StateType.TASK_TREE);
    }

    public void addListener(StateChangeListener listener) {
        listeners.add(listener);
    }

    private void notifyListeners(StateType type) {
        for (StateChangeListener listener : listeners) {
            listener.onStateChanged(type);
        }
    }
}
```

2. **ShannonUIMod.java の簡素化**

```java
// 全ての static フィールドを削除
// StateManager経由でアクセス
```

#### 期待効果

- 状態の変更を追跡しやすくなる
- リアクティブな UI 更新が可能
- テストが書きやすい

---

### Phase 4: Frontend - HTTP エンドポイントの分離（優先度: 中）

#### 目標

HTTP サーバーロジックを専用クラスに分離

#### 作業内容

1. **HttpServerManager の作成**

```java
// ShannonUIMod/src/main/java/com/shannon/server/HttpServerManager.java
public class HttpServerManager {
    private HttpServer server;
    private final StateManager stateManager;

    public HttpServerManager(StateManager stateManager) {
        this.stateManager = stateManager;
    }

    public void start(int port) throws IOException {
        server = HttpServer.create(new InetSocketAddress(port), 0);
        registerEndpoints();
        server.start();
    }

    private void registerEndpoints() {
        server.createContext("/task", new TaskEndpoint(stateManager));
        server.createContext("/task_logs", new LogsEndpoint(stateManager));
        server.createContext("/constant_skills", new SkillsEndpoint(stateManager));
        server.createContext("/chat", new ChatEndpoint(stateManager));
    }
}

// 各エンドポイントは別ファイル
// ShannonUIMod/src/main/java/com/shannon/server/endpoints/TaskEndpoint.java
```

#### 期待効果

- `ShannonUIMod.java`が 100 行以下に
- エンドポイントの追加・修正が容易
- ビジネスロジックと HTTP 処理が分離

---

### Phase 5: 型安全性の向上（優先度: 中）

#### Backend

1. **スキルパラメータの型定義強化**

```typescript
// backend/src/services/minebot/types.ts
export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "Vec3";
  description: string;
  required: boolean;
  default?: any;
  validation?: (value: any) => boolean;
}

export abstract class InstantSkill {
  abstract params: SkillParameter[];

  // 実行前にパラメータを検証
  protected validateParams(args: any[]): void {
    // 型チェック、必須チェック、カスタム検証
  }
}
```

2. **TaskState の型を厳密に**

```typescript
// backend/src/services/minebot/llm/graph/state/TaskState.ts
export interface TaskState {
  taskId: string;
  goal: string;
  strategy: string;
  status: TaskStatus;
  understanding?: UnderstandingResult;
  plan?: PlanResult;
  executionResults?: ExecutionResult[];
  reflection?: ReflectionResult;
  logs: DetailedLog[];
  messages: BaseMessage[];
  error?: Error;
}

export type TaskStatus =
  | "pending"
  | "understanding"
  | "planning"
  | "executing"
  | "reflecting"
  | "completed"
  | "error";
```

#### Frontend

1. **パケットの型安全性向上**

```java
// 共通のPacketCodec基底クラスを作成
// ShannonUIMod/src/main/java/com/shannon/network/packet/base/BasePacketCodec.java
```

---

### Phase 6: パフォーマンス最適化（優先度: 低）

#### 作業内容

1. **ログの送信を最適化**

   - 差分送信の実装（既に`LogSender`に一部実装済み）
   - バッチ送信（複数ログをまとめて送信）

2. **UI のレンダリング最適化**

   - 見えていない範囲のテキストはレンダリングしない
   - スクロール時の再計算を最小化

3. **パケットサイズの削減**
   - ログの内容を圧縮（長すぎる場合）
   - 不要なメタデータを削除

---

## 📅 実装スケジュール

### Week 1-2: Phase 1（ノード構造の整理）

- [ ] 新しいディレクトリ構造の作成
- [ ] `ExecutionNode`の統合実装
- [ ] 旧ノードの削除
- [ ] テスト実行、動作確認

### Week 3: Phase 2（ログシステムの一元化）

- [ ] `CentralLogManager`の実装
- [ ] 各ノードの修正
- [ ] テスト実行、動作確認

### Week 4: Phase 3（Frontend 状態管理）

- [ ] `StateManager`の実装
- [ ] `ShannonUIMod.java`のリファクタリング
- [ ] UI 更新ロジックの修正

### Week 5: Phase 4（HTTP エンドポイント分離）

- [ ] `HttpServerManager`の実装
- [ ] 各 Endpoint クラスの実装
- [ ] 動作確認

### Week 6: Phase 5（型安全性向上）

- [ ] Backend 型定義の強化
- [ ] Frontend 型定義の強化
- [ ] 全体的なテスト

### Week 7: Phase 6（パフォーマンス最適化）

- [ ] 各種最適化の実装
- [ ] ベンチマーク測定

---

## 🎯 成功基準

### 定量的指標

- [ ] `TaskGraph.ts`のコード行数: 500 行以下（現在 573 行）
- [ ] `ShannonUIMod.java`のコード行数: 100 行以下（現在 473 行）
- [ ] ノードクラスの平均行数: 150 行以下
- [ ] テストカバレッジ: 60%以上（現在 0%）

### 定性的指標

- [ ] 新しいノードの追加が 1 時間以内で可能
- [ ] 新しいスキルの追加が 30 分以内で可能
- [ ] 新しい UI タブの追加が 1 時間以内で可能
- [ ] バグ修正の平均時間が半分に短縮

---

## ⚠️ リスクと対策

### リスク 1: 既存機能の破壊

**対策**:

- 各 Phase ごとに動作確認
- 重要な機能（タスク実行、UI 表示）の手動テスト
- ロールバック可能なように各 Phase でブランチを切る

### リスク 2: 工数の見積もり誤差

**対策**:

- Phase 1 完了時点で全体のスケジュールを再評価
- 優先度の低い Phase は後回しにできる設計

### リスク 3: 新しいバグの混入

**対策**:

- コードレビュー（AI アシスタント活用）
- 動作確認の自動化（可能な範囲で）

---

## 📝 メモ

### すぐに着手すべき改善（Quick Wins）

1. **ログの見やすさ改善** ✅ 完了（タスクツリータブに統合）
2. **タブの整理** ✅ 完了（5→4 タブ）
3. **コメントの追加**: 複雑な処理にコメントを追加
4. **ファイル分割**: 巨大なファイルを分割（まずは`ShannonUIMod.java`）

### 将来的な拡張（Future Work）

- マルチタスク対応（複数のタスクを並行実行）
- タスクの優先度管理
- タスクのキューイング
- タスク履歴の保存・検索
- UI テーマのカスタマイズ

---

## 🚀 次のアクション

1. **このドキュメントをレビュー**してフィードバック
2. **Phase 1 から着手**（ノード構造の整理）
3. **週次で進捗確認**

リファクタリングは大変ですが、将来の開発スピードと品質が大幅に向上します！💪
