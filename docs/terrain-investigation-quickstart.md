# 地形調査スキル - クイックスタート

## インストール

スキルは自動的に読み込まれます。新しく追加されたファイル：

- `backend/src/services/minebot/instantSkills/getBlocksInArea.ts`
- `backend/src/services/minebot/instantSkills/investigateTerrain.ts`

## 基本的な使い方

### 1. シンプルな調査（推奨）

ほとんどの場合、`investigate-terrain`だけで十分です：

```typescript
// Minecraftチャットから（ユーザーが入力）
「家を建てられる平地を探して」
「近くに鉄鉱石はある？」
「この建物は何で作られている？」
```

bot が自動的に`investigate-terrain`スキルを使って調査します。

### 2. 直接スキルを呼び出す

プログラムから直接呼び出す場合：

```typescript
// 方法1: investigate-terrain（推奨）
const result = await bot.instantSkills
  .getSkill("investigate-terrain")
  .run("10x10の建築スペースが必要", 15);

console.log(result.result);
// → "調査結果: ボットから北に5ブロックの位置に..."

// 方法2: get-blocks-in-area（詳細制御が必要な場合）
const result = await bot.instantSkills
  .getSkill("get-blocks-in-area")
  .run(100, 64, 200, 110, 74, 210, "layers", false);

const data = JSON.parse(result.result);
console.log(data.layers);
```

## よくある使用パターン

### パターン 1: 建築前の地形確認

```
ユーザー: 「大きな家を建てたい。15x15くらいの平地を探して」

Bot: investigate-terrain を実行
→ 「現在地から東に8ブロックの場所に、17x20の平坦なエリアがあります。
   地面レベルはY=67で、小さな木が2本ありますが除去は簡単です。」
```

### パターン 2: 資源探索

```
ユーザー: 「ダイヤモンドが欲しい。近くにない？」

Bot: investigate-terrain を実行
→ 「半径20ブロック以内にダイヤモンド鉱石は見つかりませんでした。
   現在Y=65におり、ダイヤモンドが見つかるY=16以下に移動する必要があります。」
```

### パターン 3: 建築物の分析

```
ユーザー: 「この村の家を真似したい。どんな構造？」

Bot: investigate-terrain を実行
→ 「この建物は2階建てです。
   サイズ: 7x9ブロック、高さ6ブロック
   主な材料: oak_planks(85個), cobblestone(60個), glass_pane(12個)
   1階は石の壁と木の床、2階は完全に木造です。」
```

## トラブルシューティング

### 問題 1: 「範囲が大きすぎます」エラー

**原因**: 一度に 10,000 ブロック以上を取得しようとしている

**解決策**:

- `searchRadius`を小さくする（デフォルト 10 で十分）
- 範囲を分割して複数回調査

```typescript
// ❌ 大きすぎる
await skill.run(context, 50); // 50x50x50 = 125,000ブロック

// ✅ 適切
await skill.run(context, 15); // 15x15x15 = 3,375ブロック
```

### 問題 2: 調査に時間がかかる

**原因**: LLM が複数回ツールを呼び出している

**対策**:

- より具体的なコンテクストを指定
- `searchRadius`を小さくする

```typescript
// ❌ 曖昧
await skill.run("周りを調べて", 20);

// ✅ 具体的
await skill.run("北側5ブロック以内に平地があるか確認", 10);
```

### 問題 3: 期待した結果が得られない

**原因**: LLM が調査方法を誤解している

**対策**:

- より詳細にコンテクストを記述
- 必要なら`get-blocks-in-area`を直接使う

```typescript
// LLMに任せる
await investigateTerrain.run("石がどれくらいあるか");

// 自分で制御
const result = await getBlocksInArea.run(
  botPos.x - 10,
  botPos.y - 5,
  botPos.z - 10,
  botPos.x + 10,
  botPos.y + 5,
  botPos.z + 10,
  "stats", // 統計形式
  false
);
const data = JSON.parse(result.result);
const stoneCount = data.blockTypes.find((b) => b.block === "stone")?.count || 0;
```

## パフォーマンスのヒント

### ✅ Do's

1. **小さい範囲から始める**: radius=5-10 で十分な場合が多い
2. **適切なフォーマットを選ぶ**:
   - 材料の種類と数 → `stats`
   - 構造の形 → `layers`
   - 特定ブロックの座標 → `list`
3. **空気は省略**: `includeAir=false`（デフォルト）

### ❌ Don'ts

1. **巨大な範囲を一度にスキャンしない**
2. **不要に`includeAir=true`にしない**（トークン無駄）
3. **同じ範囲を何度もスキャンしない**（将来キャッシュ機能を追加予定）

## 実装例

### 例 1: カスタム建築前チェック

```typescript
async function checkBuildingSite(
  bot: CustomBot,
  width: number,
  length: number
) {
  const context = `${width}x${length}の建築スペースが必要。
                   平坦で、障害物がない場所を探してください。
                   地面の材質と、必要な整地作業も教えてください。`;

  const result = await bot.instantSkills
    .getSkill("investigate-terrain")
    .run(context, Math.max(width, length));

  console.log(result.result);
  return result.success;
}

// 使用
await checkBuildingSite(bot, 20, 15);
```

### 例 2: 鉱石探索ループ

```typescript
async function findOre(
  bot: CustomBot,
  oreType: string,
  maxAttempts: number = 5
) {
  for (let i = 0; i < maxAttempts; i++) {
    const context = `${oreType}を探しています。
                     半径20ブロック以内にあれば座標を教えてください。`;

    const result = await bot.instantSkills
      .getSkill("investigate-terrain")
      .run(context, 20);

    if (result.result.includes("発見") || result.result.includes("見つかり")) {
      console.log("鉱石を発見:", result.result);
      return true;
    }

    // 見つからなかったら移動
    console.log(`試行 ${i + 1}/${maxAttempts}: 見つからず、移動中...`);
    await bot.instantSkills
      .getSkill("move-to")
      .run(
        bot.entity.position.x + 30,
        bot.entity.position.y,
        bot.entity.position.z + 30
      );
  }

  return false;
}

// 使用
await findOre(bot, "diamond_ore");
```

### 例 3: 建築進捗確認

```typescript
async function checkBuildingProgress(
  bot: CustomBot,
  buildArea: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  },
  expectedBlocks: Record<string, number>
) {
  const result = await bot.instantSkills
    .getSkill("get-blocks-in-area")
    .run(
      buildArea.minX,
      buildArea.minY,
      buildArea.minZ,
      buildArea.maxX,
      buildArea.maxY,
      buildArea.maxZ,
      "stats",
      false
    );

  const data = JSON.parse(result.result);
  const progress: Record<
    string,
    { current: number; expected: number; progress: number }
  > = {};

  for (const [blockType, expectedCount] of Object.entries(expectedBlocks)) {
    const currentCount =
      data.blockTypes.find((b: any) => b.block === blockType)?.count || 0;
    progress[blockType] = {
      current: currentCount,
      expected: expectedCount,
      progress: Math.round((currentCount / expectedCount) * 100),
    };
  }

  console.log("建築進捗:", progress);
  return progress;
}

// 使用
await checkBuildingProgress(
  bot,
  { minX: 100, minY: 64, minZ: 200, maxX: 110, maxY: 70, maxZ: 210 },
  { oak_planks: 200, glass: 50, stone: 100 }
);
```

## まとめ

- **普段使い**: `investigate-terrain`に自然言語で依頼
- **細かい制御**: `get-blocks-in-area`を直接使用
- **効率**: 小さい範囲、適切なフォーマット、空気省略

詳細は[完全ドキュメント](./terrain-investigation-skills.md)を参照してください。
