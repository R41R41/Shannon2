import { useState } from "react";
import {
	MainContainer,
	ChatContainer,
	MessageList,
	Message,
	MessageInput,
	TypingIndicator,
} from "@chatscope/chat-ui-kit-react";
import OpenAIService from "@/services/openai.js";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import "./ChatScope.scss";

interface ChatScopeProps {
	openaiService: OpenAIService | null;
}

export const ChatScope: React.FC<ChatScopeProps> = ({ openaiService }) => {
	const [isTyping] = useState(false);
	const [chatMessages, setChatMessages] = useState<{ content: string; sender: string }[]>([]);

	const handleSendMessage = async (message: string) => {
		try {
		  setChatMessages((prev) => [...prev, { content: message, sender: "User" }]);
		  if (openaiService) {
			await openaiService.sendMessage(message);
		  }
		} catch (error) {
		  console.error("メッセージの送信に失敗しました:", error);
		}
	  };

	return (
    <MainContainer>
				<ChatContainer>
					<MessageList
						typingIndicator={
							isTyping ? (
								<TypingIndicator
									content={`${chatMessages[chatMessages.length - 1]?.sender}が入力中...`}
								/>
							) : null
						}
					>
						{chatMessages.map((msg, index) => (
							<Message
								key={index}
								model={{
									message: msg.content,
									sentTime: "just now",
									sender: msg.sender,
									direction: msg.sender === "User" ? "outgoing" : "incoming",
									position: "single",
								}}
							/>
						))}
					</MessageList>
					<MessageInput
						placeholder="メッセージを入力..."
				onSend={handleSendMessage}
				sendButton={true}
				attachButton={false}
			/>
		</ChatContainer>
	</MainContainer>
	);
};
