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
  const [youtubeStatus, setYoutubeStatus] = useState<ServiceStatus>('stopped');
  const [minecraftStatus, setMinecraftStatus] = useState<ServiceStatus>('stopped');
  const [minecraftPlayStatus, setMinecraftPlayStatus] = useState<ServiceStatus>('stopped');
  const [minecraftTestStatus, setMinecraftTestStatus] = useState<ServiceStatus>('stopped');
  const [minecraftYoutubeStatus, setMinecraftYoutubeStatus] = useState<ServiceStatus>('stopped');
  useEffect(() => {
    if (status?.status === 'connected') {
      status.getStatusService('twitter');
      status.getStatusService('discord');
      status.getStatusService('youtube');
      status.getStatusService('minecraft');
      status.getStatusService('minecraft:1.19.0-youtube');
      status.getStatusService('minecraft:1.19.0-test');
      status.getStatusService('minecraft:1.19.0-play');
      const cleanupTwitter = status.onServiceStatus(
        'twitter',
        setTwitterStatus
      );
      const cleanupDiscord = status.onServiceStatus(
        'discord',
        setDiscordStatus
      );
      const cleanupYoutube = status.onServiceStatus(
        'youtube',
        setYoutubeStatus
      );
      const cleanupMinecraft = status.onServiceStatus(
        'minecraft',
        setMinecraftStatus
      );
      const cleanupMinecraftYoutube = status.onServiceStatus(
        'minecraft:1.19.0-youtube',
        (status) => setMinecraftYoutubeStatus(status)
      );
      const cleanupMinecraftTest = status.onServiceStatus(
        'minecraft:1.19.0-test',
        (status) => setMinecraftTestStatus(status)
      );
      const cleanupMinecraftPlay = status.onServiceStatus(
        'minecraft:1.19.0-play',
        (status) => setMinecraftPlayStatus(status)
      );
      return () => {
        cleanupTwitter();
        cleanupDiscord();
        cleanupYoutube();
        cleanupMinecraft();
        cleanupMinecraftYoutube();
        cleanupMinecraftTest();
        cleanupMinecraftPlay();
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
    } else if (service === 'youtube') {
      if (youtubeStatus === 'running') {
        await status.stopService('youtube');
      } else {
        await status.startService('youtube');
      }
    } else if (service === 'minecraft') {
      if (minecraftStatus === 'running') {
        await status.stopService('minecraft');
      } else {
        await status.startService('minecraft');
      }
    } else if (service === 'minecraft:1.19.0-youtube') {
      if (minecraftYoutubeStatus === 'running') {
        await status.stopService('minecraft:1.19.0-youtube');
      } else {
        await status.startService('minecraft:1.19.0-youtube');
      }
    } else if (service === 'minecraft:1.19.0-test') {
      if (minecraftTestStatus === 'running') {
        await status.stopService('minecraft:1.19.0-test');
      } else {
        await status.startService('minecraft:1.19.0-test');
      }
    } else if (service === 'minecraft:1.19.0-play') {
      if (minecraftPlayStatus === 'running') {
        await status.stopService('minecraft:1.19.0-play');
      } else {
        await status.startService('minecraft:1.19.0-play');
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
        <div className={styles.serviceItem}>
          <div className={styles.info}>
            <span className={styles.name}>YouTube Bot</span>
            <span className={`${styles.status} ${styles[youtubeStatus]}`}>
              {youtubeStatus}
            </span>
          </div>
          <button
            className={`${styles.toggleButton} ${
              youtubeStatus === 'stopped' ? styles.start : styles.stop
            }`}
            onClick={() => handleToggle('youtube')}
            disabled={youtubeStatus === 'connecting'}
          >
            {youtubeStatus === 'running' ? <StopIcon /> : <PlayArrowIcon />}
          </button>
        </div>
        <div className={styles.serviceItem}>
          <div className={styles.info}>
            <span className={styles.name}>Minecraft Client</span>
            <span className={`${styles.status} ${styles[minecraftStatus]}`}>
              {minecraftStatus}
            </span>
          </div>
          <button
            className={`${styles.toggleButton} ${
              minecraftStatus === 'stopped' ? styles.start : styles.stop
            }`}
            onClick={() => handleToggle('minecraft')}
            disabled={minecraftStatus === 'connecting'}
          >
            {minecraftStatus === 'running' ? <StopIcon /> : <PlayArrowIcon />}
          </button>
        </div>
        <div className={styles.serviceItem}>
          <div className={styles.info}>
            <span className={styles.name}>Minecraft 1.19.0-youtube</span>
            <span className={`${styles.status} ${styles[minecraftYoutubeStatus]}`}>
              {minecraftYoutubeStatus}
            </span>
          </div>
              <button
            className={`${styles.toggleButton} ${
              minecraftYoutubeStatus === 'stopped' ? styles.start : styles.stop
            }`}
            onClick={() => handleToggle('minecraft:1.19.0-youtube')}
            disabled={minecraftYoutubeStatus === 'connecting'}
          >
              {minecraftYoutubeStatus === 'running' ? (
                <StopIcon />
              ) : (
                <PlayArrowIcon />
              )}
          </button>
        </div>
        <div className={styles.serviceItem}>
          <div className={styles.info}>
            <span className={styles.name}>Minecraft 1.19.0-test</span>
            <span className={`${styles.status} ${styles[minecraftTestStatus]}`}>
              {minecraftTestStatus}
            </span>
          </div>
          <button
            className={`${styles.toggleButton} ${
              minecraftTestStatus === 'stopped' ? styles.start : styles.stop
            }`}
            onClick={() => handleToggle('minecraft:1.19.0-test')}
            disabled={minecraftTestStatus === 'connecting'}
          >
            {minecraftTestStatus === 'running' ? <StopIcon /> : <PlayArrowIcon />}
          </button>
        </div>
        <div className={styles.serviceItem}>
          <div className={styles.info}>
            <span className={styles.name}>Minecraft 1.19.0-play</span>
            <span className={`${styles.status} ${styles[minecraftPlayStatus]}`}>
              {minecraftPlayStatus}
            </span>
          </div>
          <button
            className={`${styles.toggleButton} ${
              minecraftPlayStatus === 'stopped' ? styles.start : styles.stop
            }`}
            onClick={() => handleToggle('minecraft:1.19.0-play')}
            disabled={minecraftPlayStatus === 'connecting'}
          >
            {minecraftPlayStatus === 'running' ? (
              <StopIcon />
            ) : (
              <PlayArrowIcon />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatusTab;
