import { useState, useCallback } from 'react';

interface ChatMessage {
  sender: string;
  text: string;
  timestamp: number;
}

const STORAGE_KEY = 'shannon_chat_history';
const MAX_MESSAGES = 50;

function loadHistory(): ChatMessage[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    // localStorage full
  }
}

export function useChatHistory() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);

  const addMessage = useCallback((sender: string, text: string) => {
    setMessages((prev) => {
      const next = [...prev, { sender, text, timestamp: Date.now() }].slice(-MAX_MESSAGES);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { messages, addMessage, clearHistory };
}
