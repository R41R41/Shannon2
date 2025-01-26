import React, { useEffect, useState } from 'react';
import styles from './ActivityLog.module.scss';
import MonitoringService, { LogEntry } from '@/services/monitoring';

type Platform = 'web' | 'discord' | 'minecraft' | 'twitter' | 'youtube' | 'all';

const ActivityLog: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('all');

  useEffect(() => {
    const monitoring = MonitoringService();

    const handleLog = (log: LogEntry) => {
      setLogs((prevLogs) => [...prevLogs, log]);
    };

    monitoring.subscribe(handleLog);

    return () => {
      monitoring.unsubscribe(handleLog);
    };
  }, []);

  const formatContent = (content: string) => {
    return content.split('\n').map((line, i) => (
      <React.Fragment key={i}>
        {line}
        {i < content.split('\n').length - 1 && <br />}
      </React.Fragment>
    ));
  };

  const filteredLogs = logs.filter((log) =>
    selectedPlatform === 'all' ? true : log.platform === selectedPlatform
  );

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${
            selectedPlatform === 'all' ? styles.active : ''
          }`}
          onClick={() => setSelectedPlatform('all')}
        >
          All
        </button>
        <button
          className={`${styles.tab} ${
            selectedPlatform === 'web' ? styles.active : ''
          }`}
          onClick={() => setSelectedPlatform('web')}
        >
          Web
        </button>
        <button
          className={`${styles.tab} ${
            selectedPlatform === 'discord' ? styles.active : ''
          }`}
          onClick={() => setSelectedPlatform('discord')}
        >
          Discord
        </button>
        <button
          className={`${styles.tab} ${
            selectedPlatform === 'minecraft' ? styles.active : ''
          }`}
          onClick={() => setSelectedPlatform('minecraft')}
        >
          Minecraft
        </button>
        <button
          className={`${styles.tab} ${
            selectedPlatform === 'twitter' ? styles.active : ''
          }`}
          onClick={() => setSelectedPlatform('twitter')}
        >
          Twitter
        </button>
        <button
          className={`${styles.tab} ${
            selectedPlatform === 'youtube' ? styles.active : ''
          }`}
          onClick={() => setSelectedPlatform('youtube')}
        >
          YouTube
        </button>
      </div>
      <div className={styles.logList}>
        {filteredLogs.map((log, index) => (
          <div key={index} className={styles.logEntry}>
            <span className={styles.timestamp}>{log.timestamp}</span>
            {selectedPlatform === 'all' && (
              <span className={styles.platform}>{log.platform}</span>
            )}
            <span className={`${styles.content} ${styles[log.color]}`}>
              {formatContent(log.content)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActivityLog;
