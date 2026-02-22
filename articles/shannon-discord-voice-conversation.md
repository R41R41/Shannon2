---
title: "AIキャラクターとDiscordで音声会話する仕組みを作った - リアルタイム音声パイプラインの設計と実装"
emoji: "🎤"
type: "tech"
topics: ["TypeScript", "LangChain", "OpenAI", "Discord", "音声AI"]
published: false
---

## 動機：AIと「声で」話したい

テキストチャットでAIと会話するのは、もう珍しくない。

でも「声で」話すとなると、体験がまるで変わる。返答までの沈黙が1秒あるだけで不自然に感じるし、声のトーンが合っていないと違和感がある。テキストなら許される数秒のレイテンシが、音声では致命的になる。

自分たちのチーム **アイマイラボ** では、AIキャラクター「シャノン」をDiscord・X・Minecraft・Web UIなど複数のプラットフォームで活動させている。シャノンにはキャラクター設定があり、感情システムと記憶を持ち、ツールを使って検索や計算もできる。

そのシャノンと、Discordのボイスチャンネルでリアルタイムに音声会話できるようにした。

この記事では、その音声会話パイプラインの設計と実装について解説する。特に「いかに自然な会話体験を作るか」というレイテンシ最適化と、LLMが考えている間の沈黙を埋める **フィラーシステム** の設計に焦点を当てる。

---

## 全体アーキテクチャ

音声会話パイプラインの全体像はこうなっている。

```
ユーザーが話す（PTT）
    ↓
① STT: Groq Whisper で音声→テキスト変換（~300ms）
    ↓
② フィラー選択: gpt-4.1-mini で第一声を選択（~300ms）
    ↓  ← フィラー音声を即再生（ユーザーの待ち時間を埋める）
③ LLM応答生成: FCA + ツール実行（~2-5s）  ← ②と並列
    ↓
④ TTS: VOICEPEAK で文単位の音声合成（~1s/文）
    ↓  ← 1文ずつ Audio Queue に追加して即再生
⑤ Audio Queue: フィラー → 本文をシームレスに再生
```

### インフラ構成

バックエンドは Azure VM（Ubuntu）で動いているが、TTS に使う VOICEPEAK は Windows 専用ソフトだ。そこで、ローカルの Windows PC に VOICEPEAK の HTTP サーバーを立て、Tailscale 経由で Azure VM から叩く構成にしている。

```
Azure VM (Ubuntu)                  Windows PC (ローカル)
┌──────────────────┐              ┌──────────────────┐
│  Shannon Backend  │──Tailscale──│  VOICEPEAK Server │
│  (Node.js/TS)     │   HTTP      │  (Node.js HTTP)   │
│                   │              │  Japanese Female4  │
│  Discord Bot      │              └──────────────────┘
│  LLM Pipeline     │
│  Groq Whisper     │
└──────────────────┘
```

### 技術選定

| コンポーネント | 技術 | 選定理由 |
|:--|:--|:--|
| STT | Groq Whisper (`whisper-large-v3-turbo`) | 速度重視。OpenAI Whisperの3-5倍速 |
| フィラー選択 | `gpt-4.1-mini` | 精度と速度のバランス。nanoだと文脈を読み間違える |
| LLM本文生成 | `gpt-4.1-mini` + FCA | ツール呼び出し対応。TaskGraphで感情・記憶も並列処理 |
| TTS | VOICEPEAK (Japanese Female4) | 日本語の自然さ。感情パラメータでトーン変更可能 |
| 音声通話 | `@discordjs/voice` | Discord公式ライブラリ |

---

## STT: 音声認識

### Groq Whisper による高速認識

Discord のボイスチャンネルから受け取った音声データは Opus 形式でストリーミングされてくる。これを PCM16 にデコードし、WAV に変換してから Whisper API に投げる。

Groq の `whisper-large-v3-turbo` を使う理由はシンプルで、**速い**から。OpenAI の Whisper API だと 1-2秒かかるところ、Groq だと 200-400ms で返ってくる。音声会話ではこの差が効く。

```typescript
const sttClient = config.groq.apiKey ? this.groqClient : this.openaiClient;
const sttModel = config.groq.apiKey ? 'whisper-large-v3-turbo' : 'whisper-1';
const transcription = await sttClient.audio.transcriptions.create({
  model: sttModel,
  file: audioFile,
  language: 'ja',
  prompt: 'シャノンとの日常会話です。',
});
```

### Whisper ハルシネーション対策

Whisper には有名な問題がある。無音や短い音声に対して、学習データに含まれる定型文を幻覚（ハルシネーション）として出力することだ。

「ご視聴ありがとうございました」「チャンネル登録よろしくお願いします」——ユーザーは何も言っていないのに、YouTube の定型句が返ってくる。

対策として、既知のハルシネーションパターンをフィルターリストで弾いている。

```typescript
const whisperHallucinations = [
  'ご視聴ありがとうございました',
  'チャンネル登録よろしくお願いします',
  '字幕は自動生成されています',
  'Thanks for watching',
  'Subscribe to my channel',
  // ... 20+ patterns
];
if (whisperHallucinations.some(h => transcribedText.includes(h))) {
  return; // skip
}
```

泥臭いが、効果はある。新しいパターンが見つかるたびに追加している。

---

## フィラーシステム: 沈黙を埋める設計

ここがこのシステムの肝だ。

### 課題: 3-5秒の沈黙

素朴な実装だと、ユーザーが話し終えてから応答が再生されるまでに 3-5秒の沈黙が生まれる。

```
STT: ~300ms → LLM: ~2-3s → TTS: ~1-2s = 合計 3-5s の無音
```

人間同士の会話では、相手が話し終えた瞬間に「うんうん」「なるほど」「えー！」といった相槌やリアクションが入る。この **フィラー**（つなぎ言葉）がないと、相手が聞いているのかどうかすらわからない。

### 解決策: フィラーを先に再生し、LLMを並列実行

設計思想はこうだ。

1. STT 完了直後に、軽量LLM（`gpt-4.1-mini`）で適切なフィラーを選ぶ（~300ms）
2. **事前に生成・キャッシュしておいたフィラー音声を即再生**
3. フィラーが再生されている間に、本文のLLM生成を並列で走らせる
4. LLM応答が返ってきたら、文単位でTTS生成 → Audio Queueに追加

ユーザーの体感としては、「話し終えた瞬間にシャノンが反応してくれる」ようになる。実際のLLM処理は裏で走っているが、フィラーが沈黙を埋めているので待たされている感覚がない。

### フィラーの3カテゴリ

フィラーは事前に VOICEPEAK で音声ファイルを生成し、起動時にメモリにキャッシュしている。

**Atomic（短いリアクション, ~0.5-1.5秒）:**

```typescript
const ATOMIC_FILLERS: FillerEntry[] = [
  { id: 'a_sounanda', text: 'そうなんだ！', category: 'affirm', emotion: { happy: 20, fun: 30 } },
  { id: 'a_majide', text: 'まじで！？', category: 'exclaim', emotion: { happy: 30, fun: 60 } },
  { id: 'a_ettone', text: 'えっとね', category: 'thinking', emotion: {} },
  { id: 'a_makasete', text: 'ボクに任せて！', category: 'respond', emotion: { happy: 50, fun: 60 } },
  { id: 'a_shikatanai', text: '仕方ないなあ', category: 'tsun', emotion: { sad: 10, fun: 10 } },
  // ... 40+ entries
];
```

**Phrase（長めフレーズ, ~1.5-3秒）:**

```typescript
const PHRASE_FILLERS: FillerEntry[] = [
  { id: 'p_respond_1', text: 'しょうがないなぁ。教えてあげるよ。', category: 'respond', ... },
  { id: 'p_choroin_1', text: 'え、ホント！？…べ、別に嬉しくないけど。まあ、', category: 'choroin', ... },
  { id: 'p_sympathy_1', text: 'えっ…大丈夫？…別に心配してるわけじゃないけど。', category: 'sympathy', ... },
  // ...
];
```

**Combo（定義済みの組み合わせ）:**

```typescript
const COMBO_DEFINITIONS: ComboDefinition[] = [
  { id: 'c_surprise_think', fillerIds: ['a_majide', 'a_ettone'], category: 'exclaim' },
  { id: 'c_tsun_fine', fillerIds: ['a_fun', 'a_betsuniikedo'], category: 'tsun' },
  { id: 'c_ok_leave', fillerIds: ['a_wakatta', 'a_makasete'], category: 'respond' },
  // ...
];
```

各エントリには VOICEPEAK の感情パラメータ（`happy`, `fun`, `angry`, `sad`）が設定されていて、キャラクターの感情に合った声色で生成される。

### LLMによるフィラー選択

「どのフィラーを使うか」の選択自体を LLM に任せている。ルールベースではなく LLM を使う理由は、**会話の文脈を読んで適切なリアクションを選ぶ必要がある** からだ。

```typescript
export async function selectFiller(
  transcribedText: string,
  userName: string,
  conversationContext?: string,
): Promise<FillerSelection> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 60,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: `あなたはシャノン（ツンデレで自信過剰なAI）です。
ユーザーの発言を聞いた直後の「第一声」を選んでください。

場面別ガイド:
- 質問された → 「ふむふむ」「うーん」系（考える）
- 依頼・お願い → 「しょうがないなあ」「ボクに任せて」系
- 挨拶 → 挨拶系のフィラーで返す（fillerOnly）
- 褒められた → 「べ、別に嬉しくないけど」系（照れ）

NG例:
- 「面白い話して」→ ×「やったぜ！」（依頼なのに歓喜は不自然）
- 連続で同じフィラー → ×（バリエーションを出す）

${selectionList}${contextBlock}`,
      },
      { role: 'user', content: `${userName}: ${transcribedText}` },
    ],
  });
  // ...
}
```

ポイントは以下。

1. **場面別ガイド**: 質問・依頼・挨拶・褒めなど、場面ごとに適切なフィラーの方向性を指示
2. **NG例**: 実際に発生した「不適切なフィラー選択」をフィードバックとして追加
3. **会話文脈**: 直近の会話ログを渡して、文脈に沿った選択を促す
4. **fillerOnly判定**: 挨拶に挨拶で返す場合など、フィラーだけで完結するケースを判定
5. **needsTools判定**: 「天気教えて」のように外部ツールが必要なケースも同時に判定

`gpt-4.1-mini` を使っているのは、`nano` だと文脈を読み間違えることが多かったから。フィラー選択は ~300ms で返ってくるので、STT と合わせても ~600ms。フィラー音声が即座に再生される。

### フィラーと本文の接続

フィラーが再生された後にLLMの本文応答が続くので、**フィラーの内容と本文が重複しないように制御する** 必要がある。

例えば、フィラーで「いい質問じゃん！」と言った後に、本文でも「いい質問ですね」と言ったら不自然だ。

これはLLMへのプロンプトで制御している。

```typescript
const userMessageForLlm = fillerCombinedText
  ? `${transcribedText}\n\n[system: 音声会話でフィラー「${fillerCombinedText}」が既に再生済みです。
重要なルール:
(1) フィラーと同じ言葉・同じ意味の文を絶対に含めないこと
(2) フィラーの続きとして自然に繋がる内容だけを生成すること
(3) 挨拶・相槌・リアクション等はフィラーで済んでいるので、本題の回答から始めること]`
  : transcribedText;
```

---

## LLM応答生成: ツール統合

### FCA（Function Calling Agent）を音声に組み込む

シャノンのバックエンドには、Google検索・Wikipedia・天気予報・Wolfram Alpha など複数のツールを使える FCA（Function Calling Agent）がある。テキストチャットでは当然のように使っているが、音声会話でも使えるようにした。

ただし、音声ではレイテンシが重要なので、使えるツールを厳選している。

```typescript
const VOICE_ALLOWED_TOOLS = [
  'google-search',
  'fetch-url',
  'chat-on-discord',
  'get-discord-image',
  'describe-image',
  'wolfram-alpha',
  'search-by-wikipedia',
  'get-discord-recent-messages',
  'search-weather',
];
```

### ツール実行中の音声フィードバック

ツールの実行には時間がかかる。検索して結果を取得し、それを要約するまでに 5-10秒かかることもある。この間、ユーザーに何もフィードバックがないと「フリーズした？」と思われる。

そこで、ツール実行が始まった瞬間に **ツール固有の音声** を再生する仕組みを入れた。

```typescript
// ツール実行直前に呼ばれるコールバック
const voiceOnToolStarting = (toolName: string) => {
  const toolAudio = getToolFillerAudio(toolName);
  if (toolAudio) {
    eventBus.publish({
      type: 'discord:voice_enqueue',
      data: { guildId, audioBuffer: toolAudio },
    });
  }
};
```

ツールごとに専用の音声を用意している。

| ツール | 音声 |
|:--|:--|
| Google検索 | 「ん〜と、ネットの世界に聞いてみるか、どれどれ…」 |
| Wikipedia | 「wikipediaに聞いてみるか…」 |
| 天気検索 | 「天気を調べてみるね」 |
| 計算 | 「ちょっと計算させて…」 |

さらに、フィラー選択の段階でツールが必要と判定された場合は、フィラーの後・ツール実行の前に **汎用の待機音声**（「ちょっと待ちなよね」「今調べるから待ってよね」等）も再生する。

再生順序は:

```
フィラー → 汎用待機音声 → ツール固有音声 → 本文（文単位）
```

---

## TTS: VOICEPEAKによる音声合成

### なぜ VOICEPEAK か

日本語の TTS には様々な選択肢がある。OpenAI TTS、Google Cloud TTS、VOICEVOX、VOICEPEAK——それぞれ特徴がある。

VOICEPEAK を選んだ理由は、**日本語の自然さ** と **感情パラメータ** の組み合わせだ。VOICEPEAK は happy / fun / angry / sad の4パラメータで声のトーンを変えられる。シャノンの感情システム（Plutchik の感情の輪）から VOICEPEAK のパラメータへのマッピングを行うことで、「怒っているときは怒った声で」「嬉しいときは弾んだ声で」話せる。

### 文単位ストリーミングTTS

LLMの応答が長い場合、全文を一括でTTS合成すると数秒かかる。そこで、**文単位で分割してTTS合成し、1文できたら即座にAudio Queueに追加する** ストリーミング方式を採用した。

```typescript
const sentences = splitIntoSentences(responseText);
for (const s of sentences) {
  const wavBuf = await this.voicepeakClient.synthesize(s, {
    emotion: voiceEmotion,
  });
  eventBus.publish({
    type: 'discord:voice_enqueue',
    data: { guildId, audioBuffer: wavBuf },
  });
}
```

1文目の再生が始まっている間に2文目のTTSが走るので、文間のギャップが最小限になる。

### VOICEPEAK の並行処理制限

VOICEPEAK にはCLIの同時実行制限がある（1インスタンスまで）。連続でリクエストを投げると 500 エラーが返ってくる。

これに対しては、クライアント側で **クールダウン** と **リトライ** を実装して対処した。

---

## Audio Queue: シームレスな再生

Discord のボイスチャンネルで音声を再生するには、`@discordjs/voice` の `AudioPlayer` を使う。ただし、複数の音声ファイルを連続再生するには、自前のキューイングが必要だ。

Guild単位でAudio Queueを管理し、以下の順序で音声を再生する。

```
1. フィラー音声（複数可）
2. Pre-tool フィラー（ツールが必要な場合）
3. ツール固有フィラー（ツール実行中）
4. 本文音声（文単位で逐次追加）
```

キューの消費ループは非同期で動き、新しい音声バッファが追加されるたびに通知を受けて再生する。全ての音声の再生が完了したら、テキストチャンネルに応答テキストを投稿する。

```typescript
private async consumeVoiceQueue(guildId: string): Promise<void> {
  const queue = this.voiceQueues.get(guildId);
  while (true) {
    if (queue.buffers.length > 0) {
      const buf = queue.buffers.shift()!;
      await this.playAudioInVoiceChannel(guildId, buf);
      continue;
    }
    if (queue.done) break;
    // バッファが空だがまだ完了していない → 追加を待つ
    await new Promise<void>((resolve) => { queue.notify = resolve; });
  }
}
```

---

## コンテキスト管理の工夫

### Discord チャット履歴からの動的コンテキスト

音声会話のコンテキスト（直近の会話履歴）は、**Discord のテキストチャンネルのメッセージ履歴から動的に取得** している。

音声のやりとりは全て Discord のテキストチャンネルにも投稿される（`🎤 ユーザー名: テキスト` / `🔊 シャノン: 応答`）。LLM呼び出しの直前に `channel.messages.fetch()` で直近10件を取得し、会話コンテキストとして渡す。

この設計には重要なメリットがある。**ユーザーが Discord 上でメッセージを編集すれば、次の応答にはその編集が反映される。**

### HumanMessage / AIMessage の分類問題

ここでハマったのが、LangChain の `HumanMessage` / `AIMessage` の分類だ。

音声チャットでは、ユーザーの発言（`🎤 らい博士: ...`）もシャノンの応答（`🔊 シャノン: ...`）も、**全て Discord Bot のアカウントから投稿される**。つまり `msg.author.bot === true` で、全部 `AIMessage` になってしまう。

LLMから見ると、全メッセージが「AIの発言」に見えて、誰が何を言ったか区別できない。しりとりのようなターン制のゲームをすると、この問題が顕在化した。

解決策は、メッセージの `🎤` / `🔊` プレフィックスを見てメッセージの種類を判定すること。

```typescript
if (msg.author.bot) {
  // 🎤 プレフィックス → ユーザーの音声入力 → HumanMessage
  const voiceUserMatch = contentWithImages.match(/^🎤\s*(.+?):\s*/);
  if (voiceUserMatch) {
    const voiceUserName = voiceUserMatch[1];
    const voiceText = contentWithImages.replace(/^🎤\s*.+?:\s*/, '');
    return new HumanMessage(timestamp + ' ' + voiceUserName + ': ' + voiceText);
  }
  // 🔊 プレフィックス → シャノンの応答 → AIMessage
  const shannonVoiceMatch = contentWithImages.match(/^🔊\s*シャノン:\s*/);
  if (shannonVoiceMatch) {
    const shannonText = contentWithImages.replace(/^🔊\s*シャノン:\s*/, '');
    return new AIMessage(timestamp + ' シャノン: ' + shannonText);
  }
  return new AIMessage(timestamp + ' ' + nickname + 'AI: ' + contentWithImages);
}
```

### 「音声回答を生成」ボタン: STT誤認識の訂正

Whisper の認識精度は高いが、完璧ではない。特に固有名詞やゲーム用語は間違えやすい。

そこで、PTT ボタンの横に **「💬 音声回答を生成」ボタン** を追加した。

```
[🎤 話す] [💬 音声回答を生成]
```

使い方：

1. ユーザーが話す → STT が誤認識する（例: 「すいか」→「次第です」）
2. Discord のテキストチャンネルで誤認識メッセージを編集して修正
3. 「💬 音声回答を生成」ボタンを押す
4. チャット履歴から直近のユーザーメッセージを取得し、修正後のテキストで音声応答を生成

このボタンは STT をスキップしてテキストを直接パイプラインに渡すため、テキストで打ったメッセージに対しても音声回答を返せる。

---

## レイテンシの内訳

実測値をまとめると以下のようになる。

| ステップ | 所要時間 | 備考 |
|:--|:--|:--|
| STT (Groq Whisper) | ~300ms | OpenAI Whisperだと ~1-2s |
| フィラー選択 (gpt-4.1-mini) | ~300ms | ユーザー体感の応答開始はここ |
| フィラー音声再生 | ~500-2000ms | キャッシュ済みWAVの即再生 |
| LLM本文生成 (FCA) | ~2-5s | ツールありだと長くなる |
| TTS (VOICEPEAK, 1文) | ~800-1500ms | 文の長さに依存 |

**フィラーなしの場合**: ユーザーが話し終えてから **3-5秒の完全な沈黙** の後に応答が始まる。

**フィラーありの場合**: 話し終えてから **~600ms** でフィラーの第一声が返り、その後途切れることなく本文の応答が続く。

体感の差は圧倒的だ。

---

## まとめ

AIキャラクターとの音声会話を「自然に感じる」ようにするには、単に STT → LLM → TTS を直列に繋ぐだけでは足りない。

実装して得た知見をまとめる。

1. **レイテンシは体感で潰す**: 実際の処理時間を短縮するのは限界がある。フィラーで「反応している感」を出すことで、ユーザーの待ち時間の感覚を大幅に改善できる
2. **フィラー選択はLLMに任せる**: ルールベースでは文脈に合ったリアクションが選べない。軽量LLMを使えば ~300ms で適切なフィラーを選択できる
3. **文単位ストリーミングTTS**: 全文一括より文単位で逐次合成・再生する方が、体感のレイテンシが大幅に改善する
4. **ツール実行中のフィードバックは必須**: 検索や計算中に無音だとフリーズに見える。ツール固有の音声で「今何をしているか」を伝える
5. **コンテキストの正確な分類**: 音声チャットでは全メッセージがBot投稿になるため、HumanMessage/AIMessage の分類を手動で行う必要がある

### 今後

- **OpenAI Realtime API との比較**: 現在のパイプラインは自前だが、Realtime API を使えばSTT+LLMが統合される。ただしカスタムTTS（VOICEPEAK）が使えなくなるトレードオフがある
- **LLMストリーミング対応**: 現在はLLMの応答全文を待ってからTTSに渡しているが、ストリーミングで1文ずつ受け取れば更にレイテンシを短縮できる
- **話者分離**: 複数人が同時にボイスチャンネルにいる場合の対応
