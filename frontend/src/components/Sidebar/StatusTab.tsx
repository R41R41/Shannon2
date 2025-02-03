import React, { useState, useEffect } from 'react';
import { ServiceStatus } from '@common/types';
import { StatusAgent } from '@/services/agents/statusAgent';
import styles from './StatusTab.module.scss';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';

interface StatusTabProps {
  status: StatusAgent | null;
}

const StatusTab: React.FC<StatusTabProps> = ({ status }) => {
  const [twitterStatus, setTwitterStatus] = useState<ServiceStatus>('stopped');
  const [discordStatus, setDiscordStatus] = useState<ServiceStatus>('stopped');

  useEffect(() => {
    if (status?.status === 'connected') {
      status.getStatusService('twitter');
      status.getStatusService('discord');
      const cleanupTwitter = status.onServiceStatus(
        'twitter',
        setTwitterStatus
      );
      const cleanupDiscord = status.onServiceStatus(
        'discord',
        setDiscordStatus
      );
      return () => {
        cleanupTwitter();
        cleanupDiscord();
      };
    }
  }, [status]);

  const handleToggle = async (service: string) => {
    if (!status) return;
    if (service === 'twitter') {
      if (twitterStatus === 'running') {
        await status.stopService('twitter');
      } else {
        await status.startService('twitter');
      }
    } else if (service === 'discord') {
      if (discordStatus === 'running') {
        await status.stopService('discord');
      } else {
        await status.startService('discord');
      }
    }
  };

  return (
    <div className={styles.container}>
      <span className={styles.title}>Service Status</span>
      <div className={styles.serviceList}>
        <div className={styles.serviceItem}>
          <div className={styles.info}>
            <span className={styles.name}>Twitter Bot</span>
            <span className={`${styles.status} ${styles[twitterStatus]}`}>
              {twitterStatus}
            </span>
          </div>
          <button
            className={`${styles.toggleButton} ${
              twitterStatus === 'stopped' ? styles.start : styles.stop
            }`}
            onClick={() => handleToggle('twitter')}
            disabled={twitterStatus === 'connecting'}
          >
            {twitterStatus === 'running' ? <StopIcon /> : <PlayArrowIcon />}
          </button>
        </div>
        <div className={styles.serviceItem}>
          <div className={styles.info}>
            <span className={styles.name}>Discord Bot</span>
            <span className={`${styles.status} ${styles[discordStatus]}`}>
              {discordStatus}
            </span>
          </div>
          <button
            className={`${styles.toggleButton} ${
              discordStatus === 'stopped' ? styles.start : styles.stop
            }`}
            onClick={() => handleToggle('discord')}
            disabled={discordStatus === 'connecting'}
          >
            {discordStatus === 'running' ? <StopIcon /> : <PlayArrowIcon />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatusTab;
