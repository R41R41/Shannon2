import OpenAI from "openai";
import { PromptType, FlattenedItem } from "@/types/CommonTypes.js";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import logger from "@/utils/logger.js";
import { WS_URL } from "@/services/apiTypes.js";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

const openai = new OpenAI({
	apiKey: OPENAI_API_KEY,
	dangerouslyAllowBrowser: true, // ローカル開発用
});

export async function getCompletion(
	prompt: string,
	systemPrompt: PromptType,
	relatedContents: string[]
): Promise<string | null> {
	try {
		const systemContent = systemPrompt.content;
		const messages: ChatCompletionMessageParam[] = [
			{
				role: "system",
				content: systemContent,
			},
			...relatedContents.map((content) => ({
				role: "system" as const,
				content: `参考になりそうな情報:\n${content}`,
			})),
			{
				role: "user",
				content: prompt,
			},
		];

		const completion = await openai.chat.completions.create({
			messages: messages,
			model: "gpt-4o-mini",
			max_tokens: 100,
		});
		return completion.choices[0].message.content;
	} catch (error) {
		logger.error("Error getting completion:", error);
		return null;
	}
}

async function getEmbedding(text: string): Promise<number[] | null> {
	try {
		const response = await openai.embeddings.create({
			model: "text-embedding-3-small",
			input: text,
		});
		return response.data[0].embedding;
	} catch (error) {
		console.error("Error getting embedding:", error);
		return null;
	}
}

function cosineSimilarity(vec1: number[], vec2: number[]): number {
	const dotProduct = vec1.reduce((acc, val, i) => acc + val * vec2[i], 0);
	const norm1 = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
	const norm2 = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
	return dotProduct / (norm1 * norm2);
}

export async function findRelatedContents(
	currentFileName: string,
	currentContent: string,
	files: FlattenedItem[]
): Promise<string[]> {
	const currentEmbedding = await getEmbedding(
		currentFileName + "\n" + currentContent
	);
	if (!currentEmbedding) return [];

	const similarities = await Promise.all(
		files
			.filter((file) => file.name !== currentFileName)
			.map(async (file) => {
				const embedding = await getEmbedding(file.name + "\n" + file.content);
				if (!embedding)
					return {
						content: file.name + "\n" + file.content,
						similarity: 0,
					};
				return {
					content: file.name + "\n" + file.content,
					similarity: cosineSimilarity(currentEmbedding, embedding),
				};
			})
	);

	return similarities
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, 3)
		.map((item) => item.content);
}

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
