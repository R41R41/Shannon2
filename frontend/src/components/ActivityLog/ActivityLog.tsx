import React, { useEffect, useState, useRef } from 'react';
import styles from './ActivityLog.module.scss';
import { ILog, MemoryZone } from '@/types/types';
import { isILog } from '@/types/checkTypes';
import MonitoringService from '@/services/monitoring';
import { ConnectionStatus } from '@/services/monitoring';

interface ActivityLogProps {
  monitoringStatus: ConnectionStatus;
}

const ActivityLog: React.FC<ActivityLogProps> = ({ monitoringStatus }) => {
  const [logs, setLogs] = useState<ILog[]>([]);
  const [selectedMemoryZone, setSelectedMemoryZone] = useState<MemoryZone | ''>(
    ''
  );
  const logListRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const MAX_LOGS = 200;
  const monitoring = MonitoringService();

  useEffect(() => {
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
  }, [shouldAutoScroll, monitoring]);

  useEffect(() => {
    if (monitoringStatus === 'connected') {
      const fetchAllMemoryZoneLogs = async () => {
        try {
          const allMemoryZoneLogs = await monitoring.getAllMemoryZoneLogs();
          setLogs(allMemoryZoneLogs);
        } catch (error) {
          console.error('Failed to fetch all memory zone logs:', error);
        }
      };

      fetchAllMemoryZoneLogs();
    }
  }, [monitoringStatus, monitoring]);

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
    if (!isILog(log)) {
      return false;
    }
    return selectedMemoryZone === ''
      ? true
      : log.memoryZone.includes(selectedMemoryZone);
  });

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${
            selectedMemoryZone === '' ? styles.active : ''
          }`}
          onClick={() => setSelectedMemoryZone('')}
        >
          All
        </button>
        <button
          className={`${styles.tab} ${
            selectedMemoryZone === 'web' ? styles.active : ''
          }`}
          onClick={() => setSelectedMemoryZone('web')}
        >
          ShannonUI
        </button>
        <div className={styles.dropdownTab}>
          <button
            className={`${styles.tab} ${
              selectedMemoryZone.startsWith('discord') ? styles.active : ''
            }`}
          >
            Discord:{' '}
            {selectedMemoryZone.split(':')[1] === 'toyama_server'
              ? 'とやまさば'
              : selectedMemoryZone.split(':')[1] === 'aiminelab_server'
              ? 'アイマイラボ！'
              : selectedMemoryZone.split(':')[1] === 'test_server'
              ? 'シャノンテスト用サーバー'
              : '全てのサーバー'}
          </button>
          <div className={styles.dropdownContent}>
            <button
              className={`${styles.dropdownItem} ${
                selectedMemoryZone === 'discord:toyama_server'
                  ? styles.active
                  : ''
              }`}
              onClick={() => setSelectedMemoryZone('discord:toyama_server')}
            >
              discord:とやまさば
            </button>
            <button
              className={`${styles.dropdownItem} ${
                selectedMemoryZone === 'discord:aiminelab_server'
                  ? styles.active
                  : ''
              }`}
              onClick={() => setSelectedMemoryZone('discord:aiminelab_server')}
            >
              discord:アイマイラボ！
            </button>
            <button
              className={`${styles.dropdownItem} ${
                selectedMemoryZone === 'discord:test_server'
                  ? styles.active
                  : ''
              }`}
              onClick={() => setSelectedMemoryZone('discord:test_server')}
            >
              discord:シャノンテスト用サーバー
            </button>
          </div>
        </div>
        <button
          className={`${styles.tab} ${
            selectedMemoryZone === 'minecraft' ? styles.active : ''
          }`}
          onClick={() => setSelectedMemoryZone('minecraft')}
        >
          Minecraft
        </button>
        <button
          className={`${styles.tab} ${
            selectedMemoryZone === 'twitter:schedule_post' ? styles.active : ''
          }`}
          onClick={() => setSelectedMemoryZone('twitter:schedule_post')}
        >
          twitter
        </button>
        <button
          className={`${styles.tab} ${
            selectedMemoryZone === 'youtube' ? styles.active : ''
          }`}
          onClick={() => setSelectedMemoryZone('youtube')}
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
            {selectedMemoryZone === '' && (
              <span className={styles.memoryZone}>{log.memoryZone}</span>
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
