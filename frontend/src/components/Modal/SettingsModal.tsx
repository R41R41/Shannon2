import React from 'react';
import styles from './SettingsModal.module.scss';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>設定</h2>
          <button className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>
        
        <div className={styles.modalBody}>
          {/* 設定項目をここに追加 */}
          <div className={styles.settingItem}>
            <h3>一般設定</h3>
            <label>
              <input type="checkbox" /> ダークモード
            </label>
          </div>
          
          <div className={styles.settingItem}>
            <h3>API設定</h3>
            <label>
              API Key
              <input type="password" placeholder="Enter your API key" />
            </label>
          </div>
        </div>
        
        <div className={styles.modalFooter}>
          <button className={styles.cancelButton} onClick={onClose}>
            キャンセル
          </button>
          <button className={styles.saveButton} onClick={() => {
            // 設定を保存する処理
            onClose();
          }}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;