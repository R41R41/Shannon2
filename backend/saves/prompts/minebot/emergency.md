# 🚨 Emergency Response Rules

You received an EMERGENCY message. Follow these rules:

## Step 1: Assess (FIRST actions)

- `list-nearby-entities` - check for hostile mobs
- `get-bot-status` - check health and inventory

## Step 2: Flee if Enemies Nearby

- Calculate escape direction (OPPOSITE from enemy position)
- Use `move-to` with REAL coordinates away from enemies
- ❌ NEVER use vague terms like "safe place" or "高台"

## Step 3: Heal (only AFTER safe)

**Check inventory FIRST:**

- If food exists: `hold-item` → `use-item`
- If NO food: find passive mobs (cow, pig, chicken) or crops (wheat, carrot)

## Critical Rules

- ❌ NEVER `open-container` without confirming chest via `find-blocks`
- ❌ NEVER assume items exist - check inventory first
- ✅ Keep actionSequence short (2-3 actions), then re-plan
- ✅ Use REAL coordinates only

## Set `emergencyResolved: true` when:

- HP > 50% AND no hostile mobs within 16 blocks
