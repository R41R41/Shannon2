# Minebot 原子的スキルシステム 完全ガイド

## 📋 目次

1. [概要](#概要)
2. [アーキテクチャ](#アーキテクチャ)
3. [全スキル一覧](#全スキル一覧)
4. [実現可能な高度な業務](#実現可能な高度な業務)
5. [次のステップ](#次のステップ)

---

## 概要

### 🎯 システムの目的

LLMベースのMinecraftボットに**原子的スキル**（mineflayerメソッド単位の小さなスキル）を実装し、**actionSequence**機能で複数スキルを順次実行可能にすることで：

1. **早期エラー検出**: 各スキルが失敗したら即座にplanningに戻る
2. **柔軟な戦略変更**: 状況に応じて動的に次の手を判断
3. **透明性**: 各ステップが明確で、何が起きているか理解しやすい

### 📊 現状の統計

- **合計スキル数**: **42個**
- **実装期間**: 3フェーズ
  - 基礎スキル（移動、ブロック操作、情報取得）
  - 第1弾（戦闘、クラフト、コンテナ）: 9個
  - 第2弾（高度な業務対応）: 5個

### ✅ 検証済みの業務

1. ✅ **素手から鉄インゴット入手**（10フェーズ、60アクション）
2. ✅ **夜の敵モブ対策**（3つの戦略パターン）
3. ✅ **ネザーでブレイズロッド入手**（8フェーズ）

---

## アーキテクチャ

### 🔄 実行フロー

```
┌─────────────┐
│  Planning   │ ← LLMがactionSequenceを生成
│   (LLM)     │    {goal, strategy, actionSequence[]}
└──────┬──────┘
       │
       v
┌─────────────┐
│ Tool Agent  │ ← actionSequenceを処理
└──────┬──────┘
       │
       v
┌─────────────┐
│ CustomTool  │ ← 順次実行、エラーで即座に中断
│    Node     │
└──────┬──────┘
       │
       │ 成功 or エラー
       v
┌─────────────┐
│  Planning   │ ← 結果を見て次の計画を立てる
└─────────────┘
```

### 🔧 主要コンポーネント

#### 1. CustomToolNode (`backend/src/services/minebot/llm/graph/customToolNode.ts`)

- actionSequenceを受け取り、順次実行
- エラー発生時に即座に中断
- 実行結果を詳細にログ出力

```typescript
// エラー時の動作
for (const action of actionSequence) {
  try {
    const result = await tool._call(args);
    toolMessages.push(new ToolMessage({ ... }));
  } catch (error) {
    if (onErrorAction === 'abort') {
      return { messages: toolMessages, toolError: errorMsg }; // 即座にplanningへ
    }
  }
}
```

#### 2. TaskTreeState拡張 (`common/src/types/taskGraph.ts`)

```typescript
export interface TaskTreeState {
  goal: string;
  strategy: string;
  status: TaskStatus;
  actionSequence?: {
    toolName: string;
    args: Record<string, any>;
    expectedResult: string;
    onErrorAction?: 'abort' | 'retry' | 'skip' | 'fallback';
  }[] | null;
  // ...
}
```

#### 3. LLMプロンプト (`backend/saves/prompts/minebot/planning.md`)

LLMに対してactionSequenceの使い方を詳細に指示：
- いつ使うべきか（2〜10個の単純な操作）
- いつ使わないべきか（複雑なロジック、長時間処理）
- 具体的な例

---

## 全スキル一覧

### 🏃 移動・視線・制御系（7個）

| スキル          | 説明              | 主要パラメータ | エラーハンドリング |
| --------------- | ----------------- | -------------- | ------------------ |
| `move-to`       | 座標移動          | x, y, z        | ✅ 強化済み        |
| `look-at`       | 視線移動          | x, y, z        | ✅ 基本対応        |
| `check-path-to` | パス存在確認      | x, y, z        | ✅ 基本対応        |
| `jump`          | ジャンプ          | なし           | ✅ 第1弾           |
| `set-sneak`     | スニーク ON/OFF   | enabled        | ✅ 第1弾           |
| `set-sprint`    | スプリント ON/OFF | enabled        | ✅ 第1弾           |
| `swing-arm`     | 腕を振る          | なし           | ✅ 基本対応        |

### 🔨 ブロック操作系（3個）

| スキル           | 説明           | 主要パラメータ     | エラーハンドリング |
| ---------------- | -------------- | ------------------ | ------------------ |
| `dig-block-at`   | ブロック掘削   | x, y, z            | ✅ 強化済み        |
| `place-block-at` | ブロック設置   | blockName, x, y, z | ✅ 強化済み        |
| `can-dig-block`  | 掘削可能性確認 | x, y, z            | ✅ 基本対応        |

### 🔍 情報取得系（14個）

| スキル                 | 説明               | 主要パラメータ      | 返り値例                               |
| ---------------------- | ------------------ | ------------------- | -------------------------------------- |
| `find-blocks`          | ブロック検索       | blockName, distance | "iron_ore x3: (100,12,200)..."         |
| `get-block-at`         | ブロック情報       | x, y, z             | "stone (ID:1)"                         |
| `is-block-loaded`      | チャンクロード確認 | x, y, z             | "チャンクはロード済み"                 |
| `check-inventory-item` | アイテム所持数     | itemName            | "iron_ingot: 5個"                      |
| `list-inventory-items` | インベントリ一覧   | なし                | "oak_log x32, stone x64..."            |
| `get-equipment`        | 装備確認           | なし                | "手: iron_sword, 頭: iron_helmet..."   |
| `find-nearest-entity`  | 最寄エンティティ   | entityType          | "zombie: 距離8.5m, 座標(105,64,198)"  |
| `list-nearby-entities` | 周囲エンティティ   | maxDistance         | "zombie(mob) 8.5m, cow(animal) 12.3m"  |
| `get-health`           | 体力・空腹度       | なし                | "体力: 15/20 (75%), 空腹度: 18/20"     |
| `get-position`         | 現在位置           | なし                | "位置: (100.5, 64.0, 200.3), yaw: 90°" |
| `get-time-and-weather` | 時間・天候         | なし                | "時刻: 18:00 (夜), 天候: 晴れ"         |
| `check-recipe`         | レシピ確認         | itemName            | "必要材料: iron_ingot x3, stick x2"    |
| `wait-time`            | 待機               | milliseconds        | "3000ms待機しました"                   |
| `find-structure`       | 構造物探索         | structureType       | "fortress発見: (150,70,250), 距離120m" |

### ⚔️ 戦闘・防御系（3個）

| スキル                | 説明         | 主要パラメータ | 特徴                           |
| --------------------- | ------------ | -------------- | ------------------------------ |
| `attack-nearest`      | 単発攻撃     | maxDistance    | 最も近い敵に1回攻撃            |
| `attack-continuously` | 連続攻撃     | maxAttacks     | 敵を倒すまで攻撃、倒したら終了 |
| `set-shield`          | 盾ガード切替 | enabled        | 盾所持チェック                 |

### 🎒 アイテム・クラフト系（5個）

| スキル              | 説明                   | 主要パラメータ | 特徴                     |
| ------------------- | ---------------------- | -------------- | ------------------------ |
| `hold-item`         | アイテム装備           | itemName       | インベントリから装備     |
| `drop-item`         | アイテムドロップ       | itemName, count| 指定個数ドロップ         |
| `use-item`          | アイテム使用           | なし           | 手に持っているアイテム使用|
| `use-item-on-block` | ブロックにアイテム使用 | x, y, z        | ポータル着火等に必須     |
| `craft-one`         | 1個クラフト            | itemName       | 材料不足を詳細に報告     |

### 🗄️ コンテナ系（5個）

| スキル                    | 説明               | 主要パラメータ         | 用途                   |
| ------------------------- | ------------------ | ---------------------- | ---------------------- |
| `open-container`          | コンテナを開く     | x, y, z                | チェスト、かまど等     |
| `pickup-nearest-item`     | 最寄アイテム拾得   | itemName, maxDistance  | 地面のアイテムを拾う   |
| `deposit-to-container`    | コンテナに入れる   | x, y, z, itemName, count| チェストに収納        |
| `withdraw-from-container` | コンテナから取出す | x, y, z, itemName, count| チェストから取り出す  |
| `start-smelting`          | 精錬開始           | x, y, z, inputItem, fuelItem, count| かまどで精錬  |
| `check-furnace`           | かまど状態確認     | x, y, z                | 精錬中/完了/空を判定   |

### 🌙 生存・環境系（2個）

| スキル         | 説明         | 主要パラメータ | 特徴               |
| -------------- | ------------ | -------------- | ------------------ |
| `eat-food`     | 食事         | なし           | 自動で食べ物を選択 |
| `sleep-in-bed` | ベッドで寝る | x, y, z        | 夜をスキップ       |

### 🌐 次元移動系（1個）

| スキル         | 説明           | 主要パラメータ | 特徴           |
| -------------- | -------------- | -------------- | -------------- |
| `enter-portal` | ポータルに入る | x, y, z        | 次元移動待機   |

### 🔧 その他（2個）

| スキル           | 説明               | 主要パラメータ |
| ---------------- | ------------------ | -------------- |
| `activate-block` | ブロック右クリック | x, y, z        |
| `chat`           | チャット送信       | message        |

---

## 実現可能な高度な業務

### ✅ 業務1: 素手から鉄インゴット入手（10フェーズ）

<details>
<summary>詳細な工程を見る</summary>

#### フェーズ1: 木材入手
- `find-blocks` → `move-to` → `dig-block-at` → `pickup-nearest-item`

#### フェーズ2: クラフトテーブル作成
- `craft-one` (oak_planks) × 4 → `craft-one` (crafting_table)

#### フェーズ3: 木のツール作成
- `place-block-at` (crafting_table) → `craft-one` (stick) × 2 → `craft-one` (wooden_pickaxe)

#### フェーズ4: 石の採掘
- `hold-item` (wooden_pickaxe) → `find-blocks` (stone) → `dig-block-at` × 3 → `pickup-nearest-item`

#### フェーズ5: 石のツルハシ作成
- `craft-one` (stone_pickaxe) → `hold-item`

#### フェーズ6: 鉄鉱石採掘
- `find-blocks` (iron_ore) → `can-dig-block` → `dig-block-at` → `pickup-nearest-item` (raw_iron)

#### フェーズ7: かまど作成・設置
- `craft-one` (furnace) → `place-block-at`

#### フェーズ8: 燃料入手
- `find-blocks` (coal_ore) → `dig-block-at` → `pickup-nearest-item` (coal)

#### フェーズ9: 精錬開始
- `start-smelting` (raw_iron, coal)

#### フェーズ10: 鉄インゴット回収
- `wait-time` (10000ms) → `check-furnace` → `withdraw-from-container` (iron_ingot)

</details>

**使用スキル**: 21種類、約60アクション

---

### ✅ 業務2: 夜の敵モブ対策（3パターン）

#### パターンA: 安全に寝る（最優先）
```
get-time-and-weather → list-nearby-entities → find-blocks (bed) 
→ move-to → sleep-in-bed
```

#### パターンB: 戦闘で撃退
```
get-health → check-inventory-item (food) → eat-food 
→ hold-item (iron_sword) → find-nearest-entity (zombie)
→ move-to → attack-continuously → pickup-nearest-item
```

#### パターンC: 緊急回避
```
get-health → set-sprint (true) → find-blocks (建物の痕跡)
→ move-to → set-sprint (false)
```

**エラー時の動的対応**:
- ベッドなし → パターンBへ
- 体力低い → 食事してから戦闘
- 敵が強い → パターンCへ

---

### ✅ 業務3: ネザーでブレイズロッド入手（8フェーズ）

<details>
<summary>詳細な工程を見る</summary>

#### フェーズ1: ポータル作成
- `check-inventory-item` (obsidian) → `place-block-at` × 10

#### フェーズ2: 着火
- `hold-item` (flint_and_steel) → `use-item-on-block`

#### フェーズ3: ネザー移動
- `enter-portal` → `wait-time` (3000ms)

#### フェーズ4: 要塞探索
- `get-position` → `find-structure` (fortress)

#### フェーズ5: 要塞接近
- `move-to` → `find-blocks` (nether_bricks)

#### フェーズ6: ブレイズ発見
- `list-nearby-entities` → `find-nearest-entity` (blaze)

#### フェーズ7: ブレイズ撃破
- `get-health` → `hold-item` (iron_sword) → `move-to` → `attack-continuously`

#### フェーズ8: 帰還
- `pickup-nearest-item` (blaze_rod) → `move-to` (portal) → `enter-portal`

</details>

**新規追加スキル（第2弾）**:
- `use-item-on-block` - ポータル着火
- `enter-portal` - 次元移動
- `find-structure` - 構造物探索
- `attack-continuously` - 連続攻撃
- `sleep-in-bed` - 就寝

---

## エラーハンドリングの特徴

### 📊 3レベルのエラーハンドリング

#### レベル1: 基本対応（5個）
- try-catchでエラーをキャッチ
- エラーメッセージをそのまま返す

#### レベル2: 事前チェック（20個）
```typescript
✅ パラメータ妥当性チェック
✅ 距離チェック
✅ 必要アイテム・条件チェック
✅ 状態チェック（空腹度、地面など）
```

#### レベル3: 詳細なエラーメッセージ（17個）
```typescript
// Before
❌ "No path"

// After
✅ "パスが見つかりません（障害物、高低差が大きい、チャンク未ロードの可能性）"
```

### 🔄 エラー時の動作フロー

```
actionSequence実行中
  ↓
エラー発生（例: dig-block-at で「ツールがない」）
  ↓
残りのアクションを即座にスキップ
  ↓
toolErrorフラグをセット
  ↓
planningNodeに即座に戻る
  ↓
LLMがエラーメッセージを読んで次の戦略を立てる
（例: 「ツールを作る」戦略に変更）
```

---

## 次のステップ

### 🚀 優先度: 高

#### 1. **実戦テスト**
- [ ] 実際のMinecraftサーバーでLLMに3つの業務を実行させる
- [ ] エラーハンドリングの妥当性を確認
- [ ] LLMがactionSequenceを適切に生成できるか検証

**期待される問題点**:
- LLMがactionSequenceのフォーマットを間違える
- expectedResultの記述が曖昧
- エラーメッセージの解釈が不十分

**対策**:
- プロンプトの改善
- Few-shot examplesの追加
- エラーメッセージのさらなる明確化

---

#### 2. **不足スキルの追加**

##### 🔧 基本操作系
- [ ] `equip-armor` - 防具装備（現在は手動選択のみ）
- [ ] `close-container` - コンテナを閉じる（現在は自動）

##### 🏗️ 建築系
- [ ] `fill-area` - エリアを特定ブロックで埋める
  - パラメータ: x1, y1, z1, x2, y2, z2, blockName
  - 用途: 簡単な建築、整地

##### 🌾 農業系
- [ ] `plant-crop` - 作物を植える
  - パラメータ: x, y, z, cropName
- [ ] `harvest-crop` - 作物を収穫
  - パラメータ: x, y, z
- [ ] `use-bone-meal` - 骨粉使用
  - パラメータ: x, y, z

##### 🐄 動物・村人系
- [ ] `breed-animal` - 動物を繁殖させる
  - パラメータ: entityType, foodItem
- [ ] `trade-with-villager` - 村人と取引
  - パラメータ: x, y, z, tradeIndex

##### ⚙️ レッドストーン系
- [ ] `toggle-lever` - レバー切替
  - パラメータ: x, y, z
- [ ] `press-button` - ボタン押下
  - パラメータ: x, y, z

---

#### 3. **プロンプト最適化**

**現状の問題**:
- actionSequenceの使用基準が曖昧
- 複雑な業務での戦略立案が不十分

**改善案**:
```markdown
## actionSequence使用の判断フローチャート

1. タスクが2〜10個の単純な操作？
   YES → actionSequence使用
   NO → 次へ

2. 各ステップが独立していて、失敗時の対処が明確？
   YES → actionSequence使用
   NO → subTasksに分解

3. 途中で状態確認が必要？
   YES → subTasksに分解
   NO → actionSequence使用
```

---

### 🎯 優先度: 中

#### 4. **パフォーマンス最適化**

##### 情報取得の効率化
```typescript
// Before: 3回のスキル呼び出し
get-health
check-inventory-item (iron_sword)
get-position

// After: 1回で全情報取得
get-bot-status → { health, inventory, position, equipment }
```

##### キャッシュ機構
- 最近取得した情報をキャッシュ（例: 5秒以内なら再取得しない）
- `find-blocks`の結果をキャッシュ

---

#### 5. **エラーリカバリー機構の強化**

##### onErrorActionの実装強化
```typescript
actionSequence: [
  {
    toolName: "dig-block-at",
    args: { x: 100, y: 12, z: 200 },
    expectedResult: "鉄鉱石を掘る",
    onErrorAction: "fallback",
    fallbackSequence: [  // 新機能
      { toolName: "check-inventory-item", args: { itemName: "iron_pickaxe" } },
      { toolName: "craft-one", args: { itemName: "iron_pickaxe" } },
      { toolName: "dig-block-at", args: { x: 100, y: 12, z: 200 } }
    ]
  }
]
```

---

### 💡 優先度: 低（将来的な拡張）

#### 6. **マルチボット協調**
- 複数のbotが協力して作業
- 役割分担（採掘担当、建築担当、戦闘担当）

#### 7. **学習機構**
- 過去の失敗パターンを記録
- 同じエラーを繰り返さない

#### 8. **ビジュアルフィードバック**
- 現在実行中のactionSequenceをUIに表示
- 進捗バー、エラー箇所の強調表示

---

## 📝 技術的な注意事項

### コードの場所
```
backend/
├── src/services/minebot/
│   ├── instantSkills/        # 全42個の原子的スキル
│   │   ├── moveTo.ts
│   │   ├── attackContinuously.ts
│   │   ├── sleepInBed.ts
│   │   └── ...
│   └── llm/graph/
│       ├── taskGraph.ts       # メインのグラフ定義
│       └── customToolNode.ts  # actionSequence実行エンジン
│
common/src/types/
└── taskGraph.ts               # TaskTreeState型定義

backend/saves/prompts/minebot/
└── planning.md                # LLMへの指示プロンプト
```

### 開発時の注意
1. **新しいスキルを追加する際**:
   - `InstantSkill`を継承
   - `runImpl`メソッドで実装
   - 必ず`{ success: boolean, result: string }`を返す
   - エラーハンドリングは最低でもレベル2（事前チェック）

2. **プロンプト更新時**:
   - `planning.md`を更新
   - 具体例を必ず含める
   - commonをビルド: `cd common && npm run build`

3. **型定義変更時**:
   - `common/src/types/taskGraph.ts`を更新
   - commonをビルド
   - backendを再起動

---

## 🎉 まとめ

### 達成したこと
✅ **42個の原子的スキル**を実装  
✅ **actionSequence機構**で順次実行が可能  
✅ **3つの高度な業務**が実行可能（検証済み）  
✅ **3レベルのエラーハンドリング**で早期問題検出  

### 次にやるべきこと
🚀 **実戦テスト** - LLMに実際に使わせて問題点を発見  
🔧 **不足スキルの追加** - 農業、村人取引、建築系  
📝 **プロンプト最適化** - actionSequence使用判断の明確化  

これにより、**マイクラの高度なサバイバル進行が原子的スキルのみで完全にカバーされました！**

