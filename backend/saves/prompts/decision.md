以下のメッセージを分析し、すぐに回答可能か計画が必要か判定し json 形式で出力してください

# 判定基準

- 日常会話や単純な質問 → immediate
- 調査/計算/複数ステップが必要 → plan

# 注意

判定結果（immediate/plan）のみを回答してください

# 出力形式

```json
{
  "decision": "immediate/plan"
}
```
