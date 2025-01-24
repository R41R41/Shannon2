import { WS_URL } from "@/services/apiTypes";

export class OpenAIService {
	private ws: WebSocket | null = null;
	public textCallback: ((text: string) => void) | null = null;
	public textDoneCallback: (() => void) | null = null;
	public audioCallback: ((data: string) => void) | null = null;
	public audioDoneCallback: (() => void) | null = null;
	public userTranscriptCallback: ((text: string) => void) | null = null;
	private initialized: boolean = false;

	constructor() {
		this.initialize();
	}

	async initialize() {
		if (this.initialized) return;
		this.initialized = true;
		console.log("\x1b[32minitialize\x1b[0m");

		this.ws = new WebSocket(WS_URL);

		this.ws.onopen = () => {
			console.log("\x1b[32mConnected to server\x1b[0m");
		};

		this.ws.onmessage = (event) => {
			const data = JSON.parse(event.data);
			if (data.type === "text_done") {
				this.textDoneCallback?.();
			} else if (data.type === "audio_done") {
				this.audioDoneCallback?.();
			} else if (data.type === "text") {
				this.textCallback?.(data.content);
			} else if (data.type === "audio") {
				if (!data.content.length || data.content.length === 0) return;
				console.log(
					`\x1b[32mReceived audio data: ${data.content.length} bytes\x1b[0m`
				);
				this.audioCallback?.(data.content);
			} else if (data.type === "user_transcript") {
				this.userTranscriptCallback?.(data.content);
			}
		};

		this.ws.onerror = (error) => {
			console.error("\x1b[31mWebSocket error:\x1b[0m", error);
		};

		this.ws.onclose = () => {
			console.log("\x1b[31mWebSocket connection closed\x1b[0m");
			this.ws = null;
		};
	}

	async sendMessage(message: string) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.error("\x1b[31mWebSocket is not open\x1b[0m");
			return;
		}

		const messageData = JSON.stringify({
			type: "text",
			content: message,
		});

		console.log("\x1b[32msendMessage\x1b[0m", message);
		this.ws.send(messageData);
	}

	async sendVoiceData(data: Blob) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.error("\x1b[31mWebSocket is not open\x1b[0m");
			return;
		}
		const arrayBuffer = await data.arrayBuffer();
		const base64String = btoa(
			String.fromCharCode(...new Uint8Array(arrayBuffer))
		);
		const messageData = JSON.stringify({
			type: "audio_append",
			content: base64String,
		});
		console.log("\x1b[32msendVoiceData\x1b[0m", base64String.length);
		this.ws.send(messageData);
	}

	async commitAudioBuffer() {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.error("\x1b[31mWebSocket is not open\x1b[0m");
			return;
		}

		const messageData = JSON.stringify({
			type: "audio_commit",
		});
		this.ws.send(messageData);
	}

	async vadModeChange(data: boolean) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.error("\x1b[31mWebSocket is not open\x1b[0m");
			return;
		}

		const messageData = JSON.stringify({
			type: "vad_mode_change",
			content: data.toString(),
		});
		this.ws.send(messageData);
	}
}

export default OpenAIService;
