import React, { useState, useRef } from 'react';
import styles from './PushToTalkButton.module.scss';
import { startRecording, stopRecording, stopRecordingWithoutCommit } from "@/utils/audioUtils";
import OpenAIService from "@/services/openai";

interface PushToTalkButtonProps {
  openaiService: OpenAIService;
}

export const PushToTalkButton: React.FC<PushToTalkButtonProps> = ({
  openaiService,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isVadMode, setIsVadMode] = useState(false);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const onPushToTalk = () => {
    if (isRecording) {
      stopRecording(openaiService, processorRef);
    } else {
      startRecording(setIsRecording, processorRef, openaiService);
    }
  };

  const onVadModeChange = () => {
    openaiService?.vadModeChange(!isVadMode);
    setIsVadMode(!isVadMode);
    if (isRecording) {
      stopRecordingWithoutCommit(processorRef, setIsRecording);
    } else {
      startRecording(setIsRecording, processorRef, openaiService);
    }
  };

  return (
  <div className={styles.pushToTalkButtonContainer}>
    <button
      onMouseDown={isVadMode ? () => {} : onPushToTalk}
      onMouseUp={isVadMode ? () => {} : onPushToTalk}
      className={styles.pushToTalkButton}
      style={{
        backgroundColor: isRecording || isVadMode ? "#666" : "#444",
      }}
    >
      {isRecording || isVadMode ? "音声認識中..." : "押下で音声入力"}
    </button>
    <div
      className={`${styles.recordingIndicator} ${isVadMode ? styles.active : ""}`}
      onClick={onVadModeChange}
    />
    </div>
  ); 
};
