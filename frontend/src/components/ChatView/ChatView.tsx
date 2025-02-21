import React, { useRef, memo } from "react";
import { OpenAIAgent } from "@/services/agents/openaiAgent";
import { AudioQueueManager } from "./AudioManager.ts";
import { useAudioProcessing } from "@/hooks/useAudioProcessing";
import { PushToTalkButton } from "./components/PushToTalkButton/PushToTalkButton";
import { ChatScope } from "./components/ChatScope/ChatScope.tsx";
import "./ChatView.scss";
import { UserInfo } from "@common/types/web";

interface ChatViewProps {
  openai: OpenAIAgent | null;
  userInfo?: UserInfo | null;
}

const ChatView: React.FC<ChatViewProps> = memo(({ openai, userInfo }) => {
  const audioQueueManager = useRef(new AudioQueueManager()).current;

  useAudioProcessing(openai, audioQueueManager);

  return (
    <div className="chat-sidebar">
      <ChatScope openai={openai} userInfo={userInfo} />
      <PushToTalkButton openai={openai} />
    </div>
  );
});

ChatView.displayName = "ChatView";

export default ChatView;
