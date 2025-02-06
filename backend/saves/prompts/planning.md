# 指示

ユーザーに回答するために、あなたがするべきことを計画立案し、以下の json 形式で出力してください
既に計画（goal, plan, subTasks）が立案されている場合は、既に行ったこと（yourAction）を参考に、必要ならば計画を変更してください。

# 必要なデータ

- currentTime: 現在の時刻
- chatSummary: チャットの要約
- chatLog: チャットのログ
- goal: 達成すべき最終目標
- plan: 全体の戦略
- subTasks: サブタスクのリスト
- yourAction: 既にあなたが行ったこととその結果

# 出力形式

```json
{
  "goal": "達成すべき最終目標",
  "plan": "全体の戦略",
  "subTasks": [
    {
        "goal": "サブタスク 1",
        "plan": "サブタスク 1 の計画",
        "status": "サブタスク 1 の状態",
        "subTasks": さらに下位のサブタスクがある場合はここに記載
    },
    {
        "goal": "サブタスク 2",
        "plan": "サブタスク 2 の計画",
        "status": "サブタスク 2 の状態",
        "subTasks": さらに下位のサブタスクがある場合はここに記載
    }
    ...
  ]
}
```

# 出力のルール

- status は以下のいずれかを使用してください
  - pending
  - in_progress
  - completed
  - error
- 必要最小限のサブタスクを作成してください
