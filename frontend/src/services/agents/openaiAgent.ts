import { OpenAIMessageOutput } from "@common/types/web";
import { WebSocketClientBase } from "../common/WebSocketClient";
import { URLS } from "../config/ports";
import { BaseMessage } from "@langchain/core/messages";
export class OpenAIAgent extends WebSocketClientBase {
  private static instance: OpenAIAgent;

  public static getInstance() {
    if (!OpenAIAgent.instance) {
      console.log("Creating OpenAIAgent with URL:", URLS.WEBSOCKET.OPENAI);
      OpenAIAgent.instance = new OpenAIAgent(URLS.WEBSOCKET.OPENAI);
      console.log("OpenAIAgent instance created");
    }
    return OpenAIAgent.instance;
  }
  public textCallback: ((text: string) => void) | null = null;
  public textDoneCallback: (() => void) | null = null;
  public audioCallback: ((data: string) => void) | null = null;
  public audioDoneCallback: (() => void) | null = null;
  public userTranscriptCallback: ((text: string) => void) | null = null;

  private constructor(url: string) {
    super(url);
  }

  protected handleMessage(message: string) {
    const data = JSON.parse(message) as OpenAIMessageOutput;
    if (data.type === "pong") {
      return;
    }
    if (data.type === "command" && data.command === "text_done") {
      this.textDoneCallback?.();
    } else if (data.type === "command" && data.command === "audio_done") {
      this.audioDoneCallback?.();
    } else if (data.type === "text" && data.text) {
      this.textCallback?.(data.text);
      this.textDoneCallback?.();
    } else if (data.type === "realtime_text" && data.realtime_text) {
      this.textCallback?.(data.realtime_text);
    } else if (data.type === "realtime_audio" && data.realtime_audio) {
      console.log(`Received audio data: ${data.realtime_audio.length} bytes`);
      this.audioCallback?.(data.realtime_audio);
    } else if (data.type === "user_transcript" && data.realtime_text) {
      this.userTranscriptCallback?.(data.realtime_text);
    }
  }

  async sendMessage(
    message: string,
    isRealTimeChat: boolean,
    recentChatLog?: BaseMessage[]
  ) {
    try {
      let messageData: string;
      if (isRealTimeChat) {
        messageData = JSON.stringify({
          type: "realtime_text",
          realtime_text: message,
        });
      } else {
        messageData = JSON.stringify({
          type: "text",
          text: message,
          recentChatLog: recentChatLog,
        });
      }
      this.send(messageData);
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  }

  async sendVoiceData(data: Blob) {
    try {
      const arrayBuffer = await data.arrayBuffer();
      const base64String = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer))
      );
      const messageData = JSON.stringify({
        type: "realtime_audio",
        realtime_audio: base64String,
      });
      console.log("\x1b[32msendVoiceData\x1b[0m", base64String.length);
      this.send(messageData);
    } catch (error) {
      console.error("Error sending voice data:", error);
      throw error;
    }
  }

  async commitAudioBuffer() {
    try {
      const messageData = JSON.stringify({
        type: "realtime_audio",
        command: "realtime_audio_commit",
      });
      console.log("\x1b[32mcommitAudioBuffer\x1b[0m");
      this.send(messageData);
    } catch (error) {
      console.error("Error committing audio buffer:", error);
      throw error;
    }
  }

  async vadModeChange(data: boolean) {
    try {
      const messageData = JSON.stringify({
        type: "command",
        command: data ? "realtime_vad_on" : "realtime_vad_off",
      });
      console.log("\x1b[32mvadModeChange\x1b[0m", messageData);
      this.send(messageData);
    } catch (error) {
      console.error("Error changing VAD mode:", error);
      throw error;
    }
  }
}
