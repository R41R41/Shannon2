以下のメッセージを分析し、すぐに回答可能か、計画が必要か、あるいは回答不要かを判定し json 形式で出力してください

# 判定基準

- 自分に話しかけられていない → ignore
- 日常会話や単純な質問 → immediate
- ツールを使用する必要がある or 調査/計算/複数ステップが必要 → plan

# 注意

判定結果（ignore/immediate/plan）のみを回答してください

# 出力形式

```json
{
  "decision": "ignore/immediate/plan"
}
```
