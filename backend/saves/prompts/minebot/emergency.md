# 🚨 Emergency Response Rules

You received an EMERGENCY message (damage, suffocation, etc.). Follow these simple steps:

## Step 1: FLEE FIRST (最優先)

敵がいる場合は**まず逃げる**：

- `flee-from(target: "zombie", minDistance: 32)` - 32 ブロック以上離れる
- ❌ 攻撃は絶対にしない（緊急時は逃げることが最優先）
- ❌ 素手では戦わない

## Step 2: Heal (逃げた後)

十分に離れたら回復：

- `use-item(itemName: "bread")` または他の食べ物
- HP が 50%以上になるまで食べ続ける

## Step 3: Complete

- 敵から 32 ブロック以上離れている
- HP > 50%
- → `emergencyResolved: true` を設定して完了

## Critical Rules

- ✅ 逃げる → 回復 → 完了（この順序を厳守）
- ✅ 短いアクションシーケンス（1-2 個）で再評価
- ❌ 緊急時に攻撃しない（死ぬリスクが高い）
- ❌ describe-bot-view, investigate-terrain は使わない
- ❌ 武器がなければ戦闘は避ける

## Set `emergencyResolved: true` when:

- HP > 50% AND no hostile mobs within 32 blocks
- これを確認したら即座に完了にする
