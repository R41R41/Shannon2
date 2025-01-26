import React, { useEffect, useState } from 'react';
import styles from './ActivityLog.module.scss';
import MonitoringService, { LogEntry } from '@/services/monitoring';

const ActivityLog: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

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

  return (
    <div className={styles.container}>
      <div className={styles.logList}>
        {logs.map((log, index) => (
          <div key={index} className={styles.logEntry}>
            <span className={styles.timestamp}>{log.timestamp}</span>
            <span className={styles.platform}>{log.platform}</span>
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
