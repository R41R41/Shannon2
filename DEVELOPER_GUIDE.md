# 開発者向けガイド

このドキュメントでは、SHANNONの開発に関する詳細情報を提供します。

## テスト項目・実装予定

### web

- [ ] ログインできる
- [x] text 会話ができる
- [ ] 音声会話ができる
- [x] realtime text 会話ができる
- [x] realtime audio 会話ができる
- [x] vad モードで realtime audio 会話ができる
- [x] ログが分かりやすく見れる
- [x] ログの検索ができる
- [ ] Twitter 定時投稿
- [ ] Twitter bot 起動・停止・状態
- [ ] minebot 起動・停止・状態
- [ ] minecraft 起動・停止・状態
- [ ] discord bot 起動・停止・状態

### discord

- [x] text 会話ができる
- [ ] minecraft サーバーの状態を見れる
- [ ] minecraft サーバーの起動・停止ができる
- [ ] twitter の定時ツイートが表示される

### twitter

- [ ] 定時ツイートがされる
- [ ] 定時ツイートが分かりやすい
- [ ] 投稿につき 1 返信
- [ ] アイマイラボの投稿リツイート
- [ ] ライ、ヤミーの投稿に返信

### llm

- [ ] スキル獲得
- [ ] ツールの動的読み込み
- [ ] ツール作成・テストノード
- [ ] ファイル操作系
- [ ] スキルツリー管理
- [ ] ステータスの更新ノード、必要ならプランの更新、今までのプランを読み込ませる

### youtube

- [ ] Youtube 自動返信
- [ ] 1 コメントにつき 1 返信

### minecraft

- [ ] Minecraft bot の統合
- [ ] 呼び出せるスキルの追加・二重管理の解消
- [ ] 環境状態を LLM に読ませる
- [ ] 常時：座標、HP、空腹度、インベントリ
- [ ] 検索：バイオーム、周囲ブロック、周囲エンティティ、画面

### その他

- [x] テスト体制の整備
- [ ] 複数人で web を操作しても混ざらない
- [ ] web を https ＋ドメインで公開
- [ ] 管理者モード
- [ ] 自発性
- [ ] 内部思考Agent
- [ ] 感情状態 

## 各serviceのeventBus

### web
#### monitoringAgent
##### publish
##### subscribe
- web:log
#### openaiAgent
##### publish
- web:get_message
##### subscribe
- web:post_message
#### scheduleAgent
##### publish
- web:get_schedule
- web:call_schedule
##### subscribe
- web:post_schedule

### llm
#### publish
- web:post_message
- discord:post_message
- twitter:post_scheduled_message
#### subscribe
- web:get_message
- discord:get_message
- twitter:post_scheduled_message

### discord
#### publish
- minecraft:get_status
- discord:get_message
#### subscribe
- discord:post_message

### twitter
#### publish
#### subscribe
- twitter:post_scheduled_message
- twitter:post_message

### scheduler
#### publish
- web:post_schedule
- twitter:post_scheduled_message
#### subscribe
- web:get_schedule
- web:call_schedule

### minecraft
#### publish
- minecraft:get_message
#### subscribe
- minecraft:post_message

## ログ規則

ログの色分け規則は以下の通りです。

- **error**: \x1b[31m - 赤
- **success**: \x1b[32m - 緑
- **warning**: \x1b[33m - 黄
- **started**: \x1b[34m - 青
- **updated**: \x1b[36m - シアン（水色）
- **others**: \x1b[37m - 白, \x1b[35m - マゼンタ（紫）


## ファイル構造

プロジェクトのファイル構造は以下の通りです。

```
Shannon2                                                                  
├─ backend                                                                
│  ├─ node_modules                                                                                                          
│  ├─ src                                                                 
│  │  ├─ config                                                           
│  │  ├─ jobs                                                             
│  │  ├─ models                                                     
│  │  ├─ routes                                                           
│  │  │  └─ discord.routes.ts                                             
│  │  ├─ services                                                         
│  │  │  ├─ discord                                                       
│  │  │  │  ├─ commands                                                   
│  │  │  │  ├─ events                                                     
│  │  │  │  └─ client.ts                                                  
│  │  │  ├─ llm                                                           
│  │  │  │  ├─ config                                                     
│  │  │  │  │  ├─ prompts                                                 
│  │  │  │  │  │  ├─ base_text.txt                                        
│  │  │  │  │  │  ├─ base_voice.txt                                       
│  │  │  │  │  │  ├─ discord_text.txt                                     
│  │  │  │  │  │  └─ discord_voice.txt                                    
│  │  │  │  │  └─ prompts.ts                                              
│  │  │  │  ├─ platforms                                                  
│  │  │  │  ├─ types                                                      
│  │  │  │  │  └─ index.ts                                                
│  │  │  │  ├─ utils                                                      
│  │  │  │  │  └─ errorHandler.ts                                         
│  │  │  │  ├─ client.ts                                                  
│  │  │  │  ├─ eventBus.ts                                                
│  │  │  │  └─ index.ts                                                   
│  │  │  ├─ minecraft                                                     
│  │  │  │  └─ bot.ts                                                     
│  │  │  ├─ twitter                                                       
│  │  │  │  └─ client.ts                                                  
│  │  │  └─ youtube                                                       
│  │  ├─ types                                                            
│  │  ├─ utils                                                            
│  │  │  └─ scheduler.ts                                                  
│  │  └─ server.ts                                                        
│  ├─ package-lock.json                                                   
│  ├─ package.json                                                        
│  └─ tsconfig.json                                                       
├─ frontend                                                               
│  ├─ node_modules                                                                                                             
│  ├─ public                                                              
│  │  └─ vite.svg                                                         
│  ├─ src                                                                 
│  │  ├─ assets                                                           
│  │  │  └─ react.svg                                                     
│  │  ├─ components                                                       
│  │  │  ├─ App                                                           
│  │  │  │  ├─ App.module.scss                                            
│  │  │  │  └─ App.tsx                                                    
│  │  │  └─ ChatSidebar                                                   
│  │  │     ├─ ChatSidebar.css                                            
│  │  │     └─ ChatSidebar.tsx                                            
│  │  ├─ index.css                                                        
│  │  ├─ main.tsx                                                         
│  │  └─ vite-env.d.ts                                                    
│  ├─ eslint.config.js                                                    
│  ├─ index.html                                                          
│  ├─ package-lock.json                                                   
│  ├─ package.json                                                        
│  ├─ tsconfig.app.json                                                   
│  ├─ tsconfig.json                                                       
│  ├─ tsconfig.node.json                                                  
│  └─ vite.config.ts                                                      
├─ README.md                                                              
├─ package-lock.json                                                      
└─ package.json                                                           
```