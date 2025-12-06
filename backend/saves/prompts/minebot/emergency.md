# 🚨 Emergency Response Rules

You received an EMERGENCY message (damage, suffocation, etc.). Follow these simple steps:

## Step 1: Check for Enemies (FIRST action)

- `list-nearby-entities` - 周囲に敵対的モブがいるか確認
- ❌ describe-bot-view は使わない（遅い）
- ❌ investigate-terrain は使わない（不要）

## Step 2: React Based on Enemies

**If hostile mobs nearby:**

- `flee-from` with target (entity name or coordinates)
- Example: `flee-from(target: "zombie")` or `flee-from(target: "100,64,200")`

**If NO hostile mobs:**

- Skip to Step 3 directly

## Step 3: Heal (if needed)

- `use-item` with food (bread, cooked_beef, etc.)
- Check `get-bot-status` if unsure about inventory

## Critical Rules

- ✅ 敵がいなければ即座に食事で体力回復
- ✅ 短いアクションシーケンス（1-2 個）でプランを再評価
- ❌ 長い調査は不要（status: completed を早めに設定）

## Set `emergencyResolved: true` when:

- HP > 50% AND no hostile mobs within 16 blocks
- これを確認したら即座に完了にする
