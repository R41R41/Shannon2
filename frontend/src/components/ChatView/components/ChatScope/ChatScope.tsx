import { useState } from 'react';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  TypingIndicator,
  InputToolbox,
} from '@chatscope/chat-ui-kit-react';
import { OpenAIService } from '@/services/openai';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import './ChatScope.scss';

interface ChatScopeProps {
  openaiService: OpenAIService | null;
}

export const ChatScope: React.FC<ChatScopeProps> = ({ openaiService }) => {
  const [isTyping] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    { content: string; sender: string }[]
  >([]);
  const [processingChatMessageIndex, setProcessingChatMessageIndex] =
    useState<number>(0);
  const [isRealTimeChat, setIsRealTimeChat] = useState(false);

  const handleSendMessage = async (message: string) => {
    try {
      setChatMessages((prev) => [
        ...prev,
        { content: message, sender: 'User' },
      ]);
      if (openaiService) {
        await openaiService.sendMessage(message, isRealTimeChat);
      }
    } catch (error) {
      console.error('メッセージの送信に失敗しました:', error);
    }
  };

  if (openaiService) {
    openaiService.textCallback = (text: string) => {
      if (processingChatMessageIndex > chatMessages.length) {
        setChatMessages((prev) => {
          return [...prev, { content: text, sender: 'AI' }];
        });
      } else {
        setChatMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && lastMessage.sender === 'AI') {
            return [
              ...prev.slice(0, -1),
              { content: lastMessage.content + text, sender: 'AI' },
            ];
          } else {
            return [...prev, { content: text, sender: 'AI' }];
          }
        });
      }
    };
    openaiService.textDoneCallback = () => {
      setProcessingChatMessageIndex(chatMessages.length + 1);
    };
    openaiService.userTranscriptCallback = (text) => {
      setChatMessages((prev) => [...prev, { content: text, sender: 'User' }]);
    };
  }

  return (
    <MainContainer>
      <ChatContainer>
        <MessageList
          typingIndicator={
            isTyping ? (
              <TypingIndicator
                content={`${
                  chatMessages[chatMessages.length - 1]?.sender
                }が入力中...`}
              />
            ) : null
          }
        >
          {chatMessages.map((msg, index) => (
            <Message
              key={index}
              model={{
                message: msg.content,
                sentTime: 'just now',
                sender: msg.sender,
                direction: msg.sender === 'User' ? 'outgoing' : 'incoming',
                position: 'single',
              }}
            />
          ))}
        </MessageList>
        <MessageInput
          placeholder="メッセージを入力..."
          onSend={handleSendMessage}
          sendButton={false}
          attachButton={false}
        />
        <InputToolbox>
          <label className="switch">
            <input
              type="checkbox"
              checked={isRealTimeChat}
              onChange={(e) => setIsRealTimeChat(e.target.checked)}
            />
            <span className="slider"></span>
          </label>
          <span>Realtime API</span>
        </InputToolbox>
      </ChatContainer>
    </MainContainer>
  );
};
