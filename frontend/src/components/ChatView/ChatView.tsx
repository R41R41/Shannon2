import React, { useRef, memo } from 'react';
import { OpenAIAgent } from '@/services/agents/openaiAgent';
import { AudioQueueManager } from './AudioManager.ts';
import { useAudioProcessing } from '@/hooks/useAudioProcessing';
import { PushToTalkButton } from './components/PushToTalkButton/PushToTalkButton';
import { ChatScope } from './components/ChatScope/ChatScope.tsx';
import './ChatView.scss';

interface ChatViewProps {
  openai: OpenAIAgent | null;
}

const ChatView: React.FC<ChatViewProps> = memo(({ openai }) => {
  const audioQueueManager = useRef(new AudioQueueManager()).current;

  useAudioProcessing(openai, audioQueueManager);

  return (
    <div className="chat-sidebar">
      <ChatScope openai={openai} />
      <PushToTalkButton openai={openai} />
    </div>
  );
});

ChatView.displayName = 'ChatView';

export default ChatView;
