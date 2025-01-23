import React, { useState, useEffect, useRef } from "react";
import {
	MainContainer,
	ChatContainer,
	MessageList,
	Message,
	MessageInput,
	TypingIndicator,
} from "@chatscope/chat-ui-kit-react";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import "./ChatView.css";
import OpenAIService from "@/services/openai.js";
import { AudioQueueManager } from "./AudioManager.ts";
import { useAudioProcessing } from "@/hooks/useAudioProcessing";
import { PushToTalkButton } from "./components/PushToTalkButton/PushToTalkButton";
import styles from "./ChatView.module.scss";
import { startRecording, stopRecording, stopRecordingWithoutCommit } from "@/utils/audioUtils";
const ChatView: React.FC = () => {
	const [chatMessages, setChatMessages] = useState<{ content: string; sender: string }[]>([]);
  const [openaiService, setOpenaiService] = useState<OpenAIService | null>(null);
  const [isTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVadMode, setIsVadMode] = useState(false);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueManager = useRef(new AudioQueueManager());

  useEffect(() => {
    if (!openaiService) {
      setOpenaiService(new OpenAIService());
    }
  }, [openaiService]);

  useAudioProcessing(openaiService, audioQueueManager);

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

  const handlePushToTalk = () => {
    if (isRecording) {
      stopRecording(openaiService, processorRef);
    } else {
      startRecording(setIsRecording, processorRef, openaiService);
    }
  };

  const handleVadModeChange = () => {
    openaiService?.vadModeChange(!isVadMode);
    setIsVadMode(!isVadMode);
    if (isRecording) {
      stopRecordingWithoutCommit(processorRef, setIsRecording);
    } else {
      startRecording(setIsRecording, processorRef, openaiService);
    }
  };
  
	return (
		<div className={styles.chatSidebar}>
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
			<PushToTalkButton
				isRecording={isRecording}
				isVadMode={isVadMode}
				onPushToTalk={handlePushToTalk}
				onVadModeChange={handleVadModeChange}
			/>
		</div>
	);
};

export default ChatView;
