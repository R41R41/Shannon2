import React, { useState, useEffect } from 'react';
import { ServiceStatus } from '@common/types/common';
import styles from './MinebotBotItem.module.scss';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';

interface MinebotBotItemProps {
  status: ServiceStatus;
  onToggle: (serviceId: string) => void;
  onServerSelect: (serverName: string) => void;
}

export const MinebotBotItem: React.FC<MinebotBotItemProps> = ({
  status,
  onToggle,
  onServerSelect,
}) => {
  const [showServerList, setShowServerList] = useState<boolean>(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(`.${styles.serverList}`) && 
          !target.closest(`.${styles.toggleButton}`)) {
        setShowServerList(false);
      }
    };

    if (showServerList) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showServerList]);

  const handleServerSelect = (serverName: string) => {
    onServerSelect(serverName);
    setShowServerList(false);
  };

  return (
    <div className={styles.serviceItem}>
      <div className={styles.info}>
        <span className={styles.name}>Minebot Bot</span>
        <span className={`${styles.status} ${styles[status]}`}>
          {status}
        </span>
      </div>
      <div className={styles.controlContainer}>
        {status === 'running' ? (
          <button
            className={`${styles.toggleButton} ${styles.stop}`}
            onClick={() => onToggle('minebot:bot')}
            disabled={status !== 'running'}
          >
            <StopIcon />
          </button>
        ) : (
          <>
            <button
              className={`${styles.toggleButton} ${styles.start}`}
              onClick={() => setShowServerList(!showServerList)}
              disabled={status !== 'stopped'}
            >
              <PlayArrowIcon />
            </button>
            {showServerList && (
              <div className={styles.serverList}>
                <button
                  className={styles.serverButton}
                  onClick={() => handleServerSelect('1.19.0-test')}
                >
                  1.19.0-test
                </button>
                <button
                  className={styles.serverButton}
                  onClick={() => handleServerSelect('1.19.0-youtube')}
                >
                  1.19.0-youtube
                </button>
                <button
                  className={styles.serverButton}
                  onClick={() => handleServerSelect('1.19.0-play')}
                >
                  1.19.0-play
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}; 