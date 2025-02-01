import React, { useState, useRef } from 'react';
import styles from './PushToTalkButton.module.scss';
import {
  startRecording,
  stopRecording,
  stopRecordingWithoutCommit,
} from '@/utils/audioUtils';
import { OpenAIAgent } from '@/services/agents/openaiAgent';
import KeyboardVoiceOutlinedIcon from '@mui/icons-material/KeyboardVoiceOutlined';

interface PushToTalkButtonProps {
  openai: OpenAIAgent | null;
}

export const PushToTalkButton: React.FC<PushToTalkButtonProps> = ({
  openai,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isVadMode, setIsVadMode] = useState(false);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const onPushToTalk = () => {
    if (isRecording) {
      stopRecording(setIsRecording, openai, processorRef);
    } else {
      startRecording(setIsRecording, processorRef, openai);
    }
  };

  const onVadModeChange = () => {
    openai?.vadModeChange(!isVadMode);
    setIsVadMode(!isVadMode);
    if (isRecording) {
      stopRecordingWithoutCommit(processorRef, setIsRecording);
    } else {
      startRecording(setIsRecording, processorRef, openai);
    }
  };

  return (
    <div
      className={`${styles.pushToTalkButtonContainer} ${
        isRecording || isVadMode ? styles.active : ''
      }`}
    >
      <button
        onMouseDown={isVadMode ? () => {} : onPushToTalk}
        onMouseUp={isVadMode ? () => {} : onPushToTalk}
        className={`${styles.pushToTalkButton} ${
          isRecording || isVadMode ? styles.active : ''
        }`}
      >
        <KeyboardVoiceOutlinedIcon />
        {isRecording || isVadMode ? 'Recording...' : 'Push to Talk'}
      </button>
      <div
        className={`${styles.recordingIndicator} ${
          isRecording || isVadMode ? styles.active : ''
        }`}
        onClick={onVadModeChange}
      />
    </div>
  );
};
