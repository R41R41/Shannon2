---
title: "感情と記憶を持つAIキャラクター「シャノン」のバックエンド設計"
emoji: "🧠"
type: "tech"
topics: ["typescript", "langchain", "openai", "discord", "ai"]
published: false
---

## はじめに

「シャノン」は、AI × マイクラ実況チーム「アイマイラボ」のAIメンバーです。Discord・Web UI・YouTube で人間と会話し、画像を生成し、天気予報を調べ、Notion のページを読み、Minecraft の世界で活動します。

本記事では、シャノンのバックエンドアーキテクチャについて解説します。特に以下の設計に焦点を当てます。

- **タスクグラフ**: 感情分析 → 記憶取得 → ツール実行の3段パイプライン
- **感情システム**: Plutchik の感情の輪に基づく8パラメータ感情モデル
- **記憶システム**: AI自身の長期記憶と対人記憶の二層構造
- **型安全な EventBus**: TypeScript の型推論を活用したサービス間通信
- **動的ツールシステム**: ディレクトリスキャンによる自動ツール登録

:::message
Twitter連携やMinecraftボット（MineBot）は複雑なため、本記事では扱いません。
:::

## 全体アーキテクチャ

### サービス構成

シャノンのバックエンドは、複数の独立したサービスが **EventBus** で疎結合に連携する構成です。

```
┌─────────────────────────────────────────────────┐
│                    Server                        │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Discord  │  │   Web    │  │ YouTube  │      │
│  │   Bot    │  │  Client  │  │  Client  │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│       │              │              │            │
│       └──────────┬───┴──────────────┘            │
│                  ▼                                │
│           ┌────────────┐                         │
│           │  EventBus  │ ←── 型安全な Pub/Sub     │
│           └──────┬─────┘                         │
│                  ▼                                │
│       ┌──────────────────┐                       │
│       │   LLM Service    │                       │
│       │  ┌────────────┐  │                       │
│       │  │ TaskGraph   │  │                       │
│       │  │  ┌────────┐ │  │                       │
│       │  │  │Emotion │ │  │                       │
│       │  │  │Memory  │ │  │                       │
│       │  │  │  FCA   │ │  │                       │
│       │  │  └────────┘ │  │                       │
│       │  └────────────┘  │                       │
│       └──────────────────┘                       │
│                  │                                │
│       ┌──────┬──┴──┬───────┐                     │
│       ▼      ▼     ▼       ▼                     │
│   ┌──────┐┌─────┐┌──────┐┌────────┐             │
│   │Notion││ 記憶 ││画像生成││Scheduler│            │
│   └──────┘└─────┘└──────┘└────────┘             │
└─────────────────────────────────────────────────┘
```

### サービスの初期化

各サービスは Singleton パターンで管理され、`--dev` フラグで開発/本番モードを切り替えます。

```typescript
class Server {
  constructor() {
    const isDevMode = process.argv.includes('--dev');
    this.llmService = LLMService.getInstance(isDevMode);
    this.discordBot = DiscordBot.getInstance(isDevMode);
    this.twitterClient = TwitterClient.getInstance(isDevMode);
    this.scheduler = Scheduler.getInstance(isDevMode);
    this.youtubeClient = YoutubeClient.getInstance(isDevMode);
    this.notionClient = NotionClient.getInstance(isDevMode);
    // ...
  }
}
```

各サービスは `start()` で並列に起動し、特定のサービスの失敗が他に波及しないようにしています。

### モデル構成の一元管理

使用するLLMモデルは `config/models.ts` に集約しています。モデルを変更する際、ファイル1つの修正で済みます。

```typescript
export const models = {
  functionCalling: 'gpt-4.1-mini',  // メインエージェント
  emotion: 'gpt-4.1-nano',          // 感情分析（軽量）
  contentGeneration: 'gpt-5-mini',   // コンテンツ生成
  vision: 'gpt-4.1-mini',           // 画像認識
  imageGeneration: 'gpt-image-1.5',  // 画像生成
  realtime: 'gpt-realtime-mini',     // 音声（Realtime API）
  // ...
} as const;
```

## タスクグラフ: 3段パイプライン

シャノンがメッセージを受け取ってから応答するまでの処理は、**TaskGraph** が制御します。

### 処理フロー

```
ユーザーメッセージ
    │
    ▼
┌─────────────────┐
│  EmotionNode    │ ← Step 1: 感情分析（同期）
│  「喜び 80」    │
└────────┬────────┘
         ▼
┌─────────────────┐
│  MemoryNode     │ ← Step 2: 記憶取得（同期）
│  preProcess()   │   「この人は前にマイクラの話をしてた」
└────────┬────────┘
         ▼
┌─────────────────────────────────────┐
│  FunctionCallingAgent               │ ← Step 3: ツール実行ループ
│                                     │
│  while (tool_calls) {               │
│    execute tools                    │
│    ──→ EmotionNode.evaluateAsync() │ ← 非同期感情再評価
│    read latest emotion              │
│    LLM with updated context         │
│  }                                  │
└────────┬────────────────────────────┘
         ▼
┌─────────────────┐
│  MemoryNode     │ ← Step 4: 記憶保存（非同期）
│  postProcess()  │   「この会話を記憶に保存」
└─────────────────┘
```

### 実装のポイント

```typescript
public async invoke(partialState: TaskStateInput) {
  const emotionState: EmotionState = { current: null };

  // === Step 1: 初回感情分析 ===
  const emotionResult = await this.emotionNode.invoke({
    userMessage: state.userMessage,
    messages: state.messages,
  });
  emotionState.current = emotionResult.emotion;

  // === Step 2: 記憶取得 ===
  const memoryState = await this.memoryNode.preProcess({
    userMessage: state.userMessage,
    context,
  });

  // === Step 3: FunctionCallingAgent 実行 ===
  const agentResult = await this.functionCallingAgent.run({
    emotionState,  // 共有参照（FCA が毎回最新を読む）
    memoryState,
    // ツール実行後のコールバック: 非同期感情再評価
    onToolsExecuted: (messages, results) => {
      this.emotionNode
        .evaluateAsync(messages, results, emotionState.current)
        .then((newEmotion) => {
          emotionState.current = newEmotion;  // 共有状態を更新
        });
    },
    // ...
  });

  // === Step 4: 記憶保存（非同期） ===
  this.memoryNode.postProcess({ context, conversationText, exchanges });
}
```

ここで重要なのは **`emotionState` が共有参照として渡されている**点です。EmotionNode が非同期で感情を更新すると、FCA の次のイテレーションで最新の感情が反映されます。

## 感情システム: Plutchik の感情の輪

### 8つの基本感情パラメータ

シャノンの感情は、心理学者 Robert Plutchik の「感情の輪」に基づく8つのパラメータで表現されます。

```typescript
const EmotionSchema = z.object({
  emotion: z.string().describe('現在の感情を一言で表現'),
  parameters: z.object({
    joy: z.number().min(0).max(100),         // 喜び
    trust: z.number().min(0).max(100),       // 信頼
    fear: z.number().min(0).max(100),        // 恐れ
    surprise: z.number().min(0).max(100),    // 驚き
    sadness: z.number().min(0).max(100),     // 悲しみ
    disgust: z.number().min(0).max(100),     // 嫌悪
    anger: z.number().min(0).max(100),       // 怒り
    anticipation: z.number().min(0).max(100), // 期待
  }),
});
```

`emotion` はラベル（「喜び」「恍惚」「苛立ち」など）、`parameters` は0-100の数値です。これにより、たとえば「喜び 80 + 驚き 60」のような複合感情も表現できます。

### 擬似並列の感情評価

感情分析が面白いのは、**タスク実行中にリアルタイムで変化する**点です。

```
時間軸 →

EmotionNode:  [初回評価]        [非同期再評価]       [非同期再評価]
                 ↓                    ↓                    ↓
emotionState: 「期待」           「喜び」             「驚き」
                 ↑                    ↑                    ↑
FCA:          [LLM呼出] → [ツール実行] → [LLM呼出] → [ツール実行] → [応答]
```

FCA がツールを実行するたびに `onToolsExecuted` コールバックが発火し、EmotionNode が**非同期（fire-and-forget）** で感情を再評価します。FCA は次のイテレーションで最新の感情を読み取り、それをシステムプロンプトに反映させます。

これにより、「画像を検索している間に期待が高まる」「エラーが起きて不安になる」といった、人間らしい感情の変化が応答に反映されます。

```typescript
// EmotionNode: fire-and-forget の非同期評価
async evaluateAsync(
  recentMessages: BaseMessage[],
  executionResults: ExecutionResult[] | null,
  currentEmotion: EmotionType | null
): Promise<EmotionType> {
  const structuredLLM = this.model.withStructuredOutput(EmotionSchema);
  const response = await structuredLLM.invoke(messages);
  this.publishEmotion(response); // UI にも通知
  return { emotion: response.emotion, parameters: response.parameters };
}
```

感情分析には `gpt-4.1-nano`（最軽量モデル）を使い、メインの処理を遅延させないようにしています。

## 記憶システム: 二層構造

### 設計思想

AIキャラクターが「記憶」を持つことで、以下が可能になります。

- 「前にマイクラで一緒に遊んだよね」と言われたら思い出せる
- ユーザーごとの好みや性格を覚えている
- 過去の体験を踏まえた発言ができる

シャノンの記憶は **2層** に分かれています。

| レイヤー | 対象 | 例 |
|---|---|---|
| **ShannonMemory** | シャノン自身の記憶 | 「今日マイクラで家を建てた」「TypeScript の非同期処理を学んだ」 |
| **PersonMemory** | 人物ごとの記憶 | 「ライ博士はマイクラが好き」「この人は前に画像生成を頼んできた」 |

### ShannonMemory: 体験と知識

```typescript
const MAX_EXPERIENCES = 500;   // 体験の上限
const MAX_KNOWLEDGE = 300;     // 知識の上限
const PROTECTED_IMPORTANCE = 8; // 重要度8以上は削除不可
```

記憶は `experience`（体験）と `knowledge`（知識）に分類され、それぞれに容量制限があります。上限に達すると、重要度の低いものから自動削除されますが、**重要度 8 以上のものは保護**されます。

#### 重複排除

同じ記憶を何度も保存しないよう、2つの戦略で重複を排除します。

```typescript
// 体験: 24時間以内 + タグの Jaccard 類似度 ≥ 0.5 で重複判定
const EXPERIENCE_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const EXPERIENCE_JACCARD_THRESHOLD = 0.5;

// 知識: タグの Jaccard 類似度 ≥ 0.6 で重複判定（時間制限なし）
const KNOWLEDGE_JACCARD_THRESHOLD = 0.6;
```

**体験**は時間軸が重要なので「24時間以内の類似タグ」で判定します。昨日と今日で同じことをしても、それは別の体験です。一方、**知識**は時間に依存しないので、タグの類似度だけで判定します。

### MemoryNode: パターンベースの記憶トリガー

MemoryNode は、ユーザーのメッセージに含まれるキーワードから「どの記憶を取得すべきか」を判断します。

```typescript
// 「覚えてる？」「前に〜」→ 体験を検索
const EXPERIENCE_PATTERNS = [
  /前に/, /あの時/, /覚えてる/, /思い出/, /また.*したい/,
  /前回/, /昔/, /この前/, /初めて/,
];

// 「〜って何？」「教えて」→ 知識を検索
const KNOWLEDGE_PATTERNS = [
  /知ってる？/, /やり方/, /方法/, /どうやって/,
  /教えて/, /仕組み/, /って何/, /とは？/,
];

// 「今日何した？」→ 最新の体験を時系列で返す
const RECENT_ACTIVITY_PATTERNS = [
  /今日.*何.*し/, /昨日.*何.*し/, /最近.*何.*し/,
  /何してた/, /何した/, /何やってた/,
];
```

LLM に記憶検索の判断をさせるのではなく、**正規表現パターンで高速に振り分ける**ことで、トークンコストを抑えつつ必要な記憶を確実に取得します。

## ツールシステム: 動的ロード

### ディレクトリスキャンによる自動登録

ツールは `tools/` ディレクトリに `.ts` ファイルを置くだけで自動的に登録されます。

```typescript
export async function loadToolsFromDirectory(
  toolsDir: string,
): Promise<StructuredTool[]> {
  const toolFiles = readdirSync(toolsDir).filter(
    (file) => (file.endsWith('.ts') || file.endsWith('.js'))
      && !file.includes('.d.ts')
  );

  const tools: StructuredTool[] = [];
  for (const file of toolFiles) {
    const toolModule = await import(join(toolsDir, file));
    const ToolClass = toolModule.default;
    if (ToolClass?.prototype?.constructor) {
      tools.push(new ToolClass());
    }
  }
  return tools;
}
```

新しいツールを追加するときは、ファイルを作って `default export` するだけです。登録コードの修正は不要です。

### ツールの実装パターン

各ツールは LangChain の `StructuredTool` を継承し、Zod スキーマで入力を定義します。

```typescript
export default class GoogleSearchTool extends StructuredTool {
  name = 'google-search';
  description = 'Google検索を行い、結果を返す';
  schema = z.object({
    query: z.string().describe('検索クエリ'),
  });

  async _call(data: z.infer<typeof this.schema>): Promise<string> {
    // 検索を実行して結果を文字列で返す
    const results = await searchGoogle(data.query);
    return results.map(r => `${r.title}: ${r.snippet}`).join('\n');
  }
}
```

ツールの `name` と `description` と `schema` は OpenAI API の `tools` パラメータに変換され、LLM が自律的にどのツールを使うか判断します。

### 主なツール一覧

| ツール名 | 用途 |
|---|---|
| `chat-on-discord` | Discord にメッセージ送信 |
| `create-image` / `edit-image` | 画像生成・編集 |
| `google-search` | Web 検索 |
| `get-notion-page-content` | Notion ページ/DB 取得 |
| `save-experience` / `recall-experience` | 体験記憶の保存・検索 |
| `save-knowledge` / `recall-knowledge` | 知識記憶の保存・検索 |
| `recall-person` | 人物記憶の検索 |
| `update-plan` | タスク計画の更新 |
| `search-weather` | 天気予報の取得 |
| `describe-image` | 画像の内容を説明 |
| `fetch-url` | URL の内容を取得 |

## 型安全な EventBus

### 課題

サービス間通信に Pub/Sub パターンを採用すると、イベント名のタイプミスやペイロードの型不一致が実行時まで気づけない問題があります。

### EventPayloadMap による解決

すべてのイベント名とそのペイロード型を `EventPayloadMap` インターフェースにマッピングすることで、コンパイル時に型チェックが効きます。

```typescript
// common/src/types/eventMap.ts
export interface EventPayloadMap {
  // Discord
  'discord:post_message': DiscordSendTextMessageInput;
  'discord:planning': DiscordPlanningInput;

  // LLM
  'llm:get_discord_message': DiscordSendTextMessageOutput;
  'llm:get_web_message': OpenAIMessageOutput;

  // Web UI
  'web:log': ILog;
  'web:planning': TaskTreeState;
  'web:emotion': EmotionType;

  // Notion
  'notion:getPageMarkdown': NotionClientInput;
  'tool:getPageMarkdown': NotionClientOutput;

  // ... 50+ イベント定義
}
```

### 型安全な subscribe / publish

```typescript
export class EventBus {
  subscribe<T extends EventType>(
    eventType: T,
    callback: (event: TypedEvent<T>) => void  // data が自動で型推論される
  ): () => void { /* ... */ }

  publish<T extends EventType>(event: TypedEvent<T>): void { /* ... */ }
}
```

使う側はこうなります。

```typescript
// ✅ event.data は自動的に DiscordSendTextMessageInput 型
eventBus.subscribe('discord:post_message', (event) => {
  console.log(event.data.channelId); // 型推論が効く
});

// ✅ data の型が合わないとコンパイルエラー
eventBus.publish({
  type: 'discord:post_message',
  memoryZone: 'discord:aiminelab_server',
  data: { channelId: '123', content: 'hello' },
});

// ❌ コンパイルエラー: 'channel' は存在しない
eventBus.publish({
  type: 'discord:post_message',
  data: { channel: '123' },  // channelId が正しい
});
```

### メモリゾーンによるイベント分離

EventBus のイベントには `memoryZone` が付与されます。これにより、Discord のサーバーAの会話がサーバーBに漏れることを防ぎます。

```typescript
publish<T extends EventType>(event: TypedEvent<T>): void {
  this.listeners.get(event.type)?.forEach((callback) => {
    if (
      !event.targetMemoryZones ||
      event.targetMemoryZones.includes(event.memoryZone)
    ) {
      callback(event);
    }
  });
}
```

`targetMemoryZones` を指定すると、特定のゾーンにのみイベントを配信できます。

## まとめ

シャノンのバックエンドの設計を振り返ります。

| 要素 | 設計判断 | 理由 |
|---|---|---|
| サービス間通信 | 型安全な EventBus | 疎結合 + コンパイル時チェック |
| タスク処理 | 3段パイプライン | 感情・記憶・行動の分離 |
| 感情 | 擬似並列 fire-and-forget | メイン処理をブロックしない |
| 記憶 | パターンベーストリガー | LLM呼び出しコスト削減 |
| 記憶容量 | Jaccard + 時間窓で重複排除 | 有限ストレージの効率利用 |
| ツール | ディレクトリスキャン | 追加時のコード修正ゼロ |
| モデル選択 | 用途別に最適モデル | コスト最適化 |

「AIキャラクター」と聞くと単純なチャットボットを想像するかもしれませんが、感情・記憶・マルチプラットフォーム対応を考慮すると、設計すべきことは意外と多いです。この記事が、同様のプロジェクトに取り組む方の参考になれば幸いです。

---

**シャノンのソースコードは GitHub で公開しています。**
https://github.com/R41R41/Shannon2
