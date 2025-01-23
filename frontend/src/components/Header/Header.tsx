import React, { useState } from 'react';
import styles from './Header.module.scss';
import SettingsModal from '@components/SettingsModal/SettingsModal';

const Header: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.leftSection}>
          <h1 className={styles.logo}>Shannon2</h1>
        </div>
        
        <div className={styles.rightSection}>
          <button 
            className={styles.settingsButton}
            onClick={() => setIsModalOpen(true)}
          >
            設定
          </button>
        </div>
      </header>

      <SettingsModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};

export default Header;