import React, { useEffect, useState, useRef } from 'react';
import styles from './ActivityLog.module.scss';
import MonitoringService from '@/services/monitoring';
import { ILog, Platform } from '@/types/types';

type TabType = Platform | 'all';

const ActivityLog: React.FC = () => {
  const [logs, setLogs] = useState<ILog[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<TabType>('all');
  const logListRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const MAX_LOGS = 200;

  useEffect(() => {
    const monitoring = MonitoringService();

    const handleLog = (log: ILog) => {
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
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 20;
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

  const formatTimestamp = (timestamp: Date) => {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(new Date(timestamp))
      .replace(/\//g, '-');
  };

  const filteredLogs: ILog[] = logs.filter((log) => {
    return selectedPlatform === 'all'
      ? true
      : log.memoryZone.includes(selectedPlatform as Platform);
  });

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
            <span className={styles.timestamp}>
              {formatTimestamp(log.timestamp)}
            </span>
            {selectedPlatform === 'all' && (
              <span className={styles.platform}>{log.memoryZone}</span>
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
