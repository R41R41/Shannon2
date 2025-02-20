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
import { OpenAIAgent } from '@/services/agents/openaiAgent';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import './ChatScope.scss';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';

interface ChatScopeProps {
  openai: OpenAIAgent | null;
}

export const ChatScope: React.FC<ChatScopeProps> = ({ openai }) => {
  const [isTyping] = useState(false);
  const [chatMessages, setChatMessages] = useState<BaseMessage[]>([]);
  const [processingChatMessageIndex, setProcessingChatMessageIndex] =
    useState<number>(0);
  const [isRealTimeChat, setIsRealTimeChat] = useState(false);

  const handleSendMessage = async (message: string) => {
    try {
      // HTML要素を除去してプレーンテキストに変換
      const cleanMessage = message
        .replace(/<br\s*\/?>/g, '\n')  // <br>タグを改行に変換
        .replace(/<[^>]*>/g, '')       // その他のHTMLタグを除去
        .trim();
      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });

      setChatMessages((prev) => [...prev, new HumanMessage(currentTime + ' ' + "User:" + ' ' + cleanMessage)]);
      
      if (openai) {
        await openai.sendMessage(cleanMessage, isRealTimeChat, chatMessages);
      }
    } catch (error) {
      console.error('メッセージの送信に失敗しました:', error);
    }
  };

  if (openai) {
    openai.textCallback = (text: string) => {
      const modifiedText = text.replace(/\\n/g, '\n');
      console.log(processingChatMessageIndex, chatMessages.length);
      if (processingChatMessageIndex > chatMessages.length-1) {
        setChatMessages((prev) => {
          const currentTime = new Date().toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
          });
          return [...prev, new AIMessage(currentTime + ' ' + "AI:" + ' ' + modifiedText)];
        });
      } else {
        setChatMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && lastMessage instanceof AIMessage) {
            return [
              ...prev.slice(0, -1),
              new AIMessage(lastMessage.content + modifiedText),
            ];
          } else {
            const currentTime = new Date().toLocaleString('ja-JP', {
              timeZone: 'Asia/Tokyo',
            });
            return [...prev, new AIMessage(currentTime + ' ' + "AI:" + ' ' + modifiedText)];
          }
        });
      }
    };
    openai.textDoneCallback = () => {
      console.log('textDoneCallback');
      setProcessingChatMessageIndex(chatMessages.length + 1);
    };
    openai.userTranscriptCallback = (text: string) => {
      const currentTime = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      setChatMessages((prev) => [...prev, new HumanMessage(currentTime + ' ' + "User:" + ' ' + text)]);
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
                  chatMessages[chatMessages.length - 1] instanceof HumanMessage ? 'User' : 'AI'
                }が入力中...`}
              />
            ) : null
          }
        >
          {chatMessages.map((msg, index) => (
            <Message
              key={index}
              model={{
                message: msg instanceof HumanMessage ? String(msg.content).split('User: ')[1] : String(msg.content).split('AI: ')[1],
                sentTime: 'just now',
                sender: msg instanceof HumanMessage ? 'User' : 'AI',
                direction: msg instanceof HumanMessage ? 'outgoing' : 'incoming',
                position: 'single',
              }}
              className="copyable-message"
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
