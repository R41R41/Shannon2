import React, { useRef, memo } from 'react';
import OpenAIService from '@/services/openai.js';
import { AudioQueueManager } from './AudioManager.ts';
import { useAudioProcessing } from '@/hooks/useAudioProcessing';
import { PushToTalkButton } from './components/PushToTalkButton/PushToTalkButton';
import { ChatScope } from './components/ChatScope/ChatScope.tsx';
import './ChatView.scss';

const ChatView: React.FC = memo(() => {
  const openaiService = useRef(OpenAIService()).current;
  const audioQueueManager = useRef(new AudioQueueManager()).current;

  useAudioProcessing(openaiService, audioQueueManager);

  return (
    <div className="chat-sidebar">
      <ChatScope openaiService={openaiService} />
      <PushToTalkButton openaiService={openaiService} />
    </div>
  );
});

ChatView.displayName = 'ChatView';

export default ChatView;
