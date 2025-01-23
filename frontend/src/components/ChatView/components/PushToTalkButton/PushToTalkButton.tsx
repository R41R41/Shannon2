import React from 'react';
import styles from './PushToTalkButton.module.scss';

interface PushToTalkButtonProps {
  isRecording: boolean;
  isVadMode: boolean;
  onPushToTalk: () => void;
  onVadModeChange: () => void;
}

export const PushToTalkButton: React.FC<PushToTalkButtonProps> = ({
  isRecording,
  isVadMode,
  onPushToTalk,
  onVadModeChange,
}) => (
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