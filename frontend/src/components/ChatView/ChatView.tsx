import React, { useRef } from "react";
import OpenAIService from "@/services/openai.js";
import { AudioQueueManager } from "./AudioManager.ts";
import { useAudioProcessing } from "@/hooks/useAudioProcessing";
import { PushToTalkButton } from "./components/PushToTalkButton/PushToTalkButton";
import { ChatScope } from "./components/ChatScope/ChatScope.tsx";
import "./ChatView.scss";

const ChatView: React.FC = () => {
  	const openaiService = new OpenAIService();
 	const audioQueueManager = useRef(new AudioQueueManager());

  	useAudioProcessing(openaiService, audioQueueManager);
  
	return (
		<div className="chat-sidebar">
			<ChatScope
				openaiService={openaiService}
			/>
			<PushToTalkButton
				openaiService={openaiService}
			/>
		</div>
	);
};

export default ChatView;
