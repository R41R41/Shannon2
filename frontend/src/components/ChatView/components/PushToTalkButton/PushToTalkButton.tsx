import React, { useState, useRef } from 'react';
import styles from './PushToTalkButton.module.scss';
import {
  startRecording,
  stopRecording,
  stopRecordingWithoutCommit,
} from '@/utils/audioUtils';
import { OpenAIService } from '@/services/openai';
import KeyboardVoiceOutlinedIcon from '@mui/icons-material/KeyboardVoiceOutlined';

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
      stopRecording(setIsRecording, openaiService, processorRef);
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
