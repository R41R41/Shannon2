import React, { useEffect, useState, useRef } from 'react';
import styles from './ActivityLog.module.scss';
import MonitoringService, { LogEntry } from '@/services/monitoring';

type Platform = 'web' | 'discord' | 'minecraft' | 'twitter' | 'youtube' | 'all';

const ActivityLog: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('all');
  const logListRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const MAX_LOGS = 200;

  useEffect(() => {
    const monitoring = MonitoringService();

    const handleLog = (log: LogEntry) => {
      setLogs((prevLogs) => {
        const newLogs = [...prevLogs, log].slice(-MAX_LOGS);
        // 新しいログが追加されたら自動スクロール
        if (shouldAutoScroll) {
          setTimeout(() => {
            logListRef.current?.scrollTo({
              top: logListRef.current.scrollHeight,
              behavior: 'smooth',
            });
          }, 0);
        }
        return newLogs;
      });
    };

    monitoring.subscribe(handleLog);

    return () => {
      monitoring.unsubscribe(handleLog);
    };
  }, [shouldAutoScroll]);

  // スクロールイベントを監視して、手動スクロール時に自動スクロールを無効化
  const handleScroll = () => {
    if (!logListRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logListRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShouldAutoScroll(isNearBottom);
  };

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
      <div ref={logListRef} className={styles.logList} onScroll={handleScroll}>
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
