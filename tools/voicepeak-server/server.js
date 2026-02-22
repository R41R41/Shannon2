const express = require("express");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.VOICEPEAK_PORT || 8090;

// VOICEPEAK executable path - adjust if installed elsewhere
const VOICEPEAK_EXE =
  process.env.VOICEPEAK_EXE_PATH ||
  "C:\\Program Files\\VOICEPEAK\\voicepeak.exe";

const TMP_DIR = path.join(os.tmpdir(), "voicepeak-server");
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", voicepeakPath: VOICEPEAK_EXE });
});

app.post("/tts", async (req, res) => {
  const { text, narrator, speed, pitch, emotion } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: "text is required" });
  }

  const outFile = path.join(
    TMP_DIR,
    `${crypto.randomUUID()}.wav`
  );

  const args = [
    "--say",
    text,
    "--narrator",
    narrator || "Japanese Female4",
    "--speed",
    String(speed || 100),
    "--pitch",
    String(pitch || 0),
    "--out",
    outFile,
  ];

  if (emotion) {
    const emotionParts = [];
    if (emotion.happy != null) emotionParts.push(`happy=${emotion.happy}`);
    if (emotion.fun != null) emotionParts.push(`fun=${emotion.fun}`);
    if (emotion.angry != null) emotionParts.push(`angry=${emotion.angry}`);
    if (emotion.sad != null) emotionParts.push(`sad=${emotion.sad}`);
    if (emotionParts.length > 0) {
      args.push("--emotion", emotionParts.join(","));
    }
  }

  console.log(`[TTS] Generating: "${text.substring(0, 50)}..." narrator=${narrator || "Japanese Female4"}`);

  execFile(VOICEPEAK_EXE, args, { timeout: 30000 }, (error, _stdout, stderr) => {
    if (error) {
      console.error("[TTS] VOICEPEAK error:", error.message);
      if (stderr) console.error("[TTS] stderr:", stderr);
      cleanup(outFile);
      return res.status(500).json({
        error: "VOICEPEAK execution failed",
        detail: error.message,
      });
    }

    if (!fs.existsSync(outFile)) {
      console.error("[TTS] Output file not created");
      return res.status(500).json({ error: "WAV file was not generated" });
    }

    const wavData = fs.readFileSync(outFile);
    cleanup(outFile);

    console.log(`[TTS] Success: ${wavData.length} bytes`);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", wavData.length);
    res.send(wavData);
  });
});

function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[VoicepeakServer] Listening on port ${PORT}`);
  console.log(`[VoicepeakServer] VOICEPEAK path: ${VOICEPEAK_EXE}`);
  console.log(`[VoicepeakServer] Temp dir: ${TMP_DIR}`);
});
