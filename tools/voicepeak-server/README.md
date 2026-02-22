# VOICEPEAK TTS Server

VOICEPEAK CLIをHTTP API化するシンプルなサーバー。
VOICEPEAKがインストールされているWindows PC上で動かす。

## セットアップ

```bash
npm install
npm start
```

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `VOICEPEAK_PORT` | サーバーポート | `8090` |
| `VOICEPEAK_EXE_PATH` | voicepeak.exeのパス | `C:\Program Files\VOICEPEAK\voicepeak.exe` |

## API

### `GET /health`
ヘルスチェック。

### `POST /tts`
テキストから音声を生成。

**Request Body:**
```json
{
  "text": "こんにちは",
  "narrator": "Japanese Female4",
  "speed": 100,
  "pitch": 0,
  "emotion": {
    "happy": 50,
    "fun": 0,
    "angry": 0,
    "sad": 0
  }
}
```

**Response:** WAV binary (`audio/wav`)

### ナレーター一覧
- `Japanese Female 1` / `Japanese Female 2` / `Japanese Female 3`
- `Japanese Female4`
- `Japanese Male 1` / `Japanese Male 2` / `Japanese Male 3`
- `Japanese Male4`
- `Japanese Female Child` / `Japanese Male Child`
