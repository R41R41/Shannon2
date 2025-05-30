# 使用方法

このドキュメントでは、SHANNONの詳細な使用方法を説明します。

## ビルド

```bash
npm run build -w common
npm run build -w backend
npm run build -w frontend
```

## バックエンドの起動

バックエンドを起動するには、以下のコマンドを使用します。

```bash
cd backend
npm start
```

バックエンドは、APIサーバーとして機能し、各種サービスと連携します。

## フロントエンドの起動

フロントエンドを起動するには、以下のコマンドを使用します。

```bash
cd frontend
npm run dev
```

フロントエンドは、ユーザーインターフェースを提供し、バックエンドと通信します。

## 各機能の使用方法

### テキストチャット

WebインターフェースまたはDiscordを通じて、テキストチャットを行います。詳細な設定は`config`フォルダ内のファイルを参照してください。

### リアルタイム音声会話

VAD対応の音声チャットを使用するには、Webインターフェースを開き、音声入力を有効にします。

### Twitter連携

Twitter連携機能を使用するには、Twitter APIキーを設定ファイルに追加してください。

### Minecraftサーバー管理

Minecraftサーバーの起動/停止や状態監視を行うには、`minecraft`フォルダ内のスクリプトを使用します。

### Youtube連携

Youtubeコメントの自動返信機能を使用するには、Youtube APIキーを設定ファイルに追加してください。

### Discord Bot

Discord Botを使用するには、Discord APIキーを設定ファイルに追加し、`discord`フォルダ内のスクリプトを実行します。
