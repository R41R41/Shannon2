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

  return (
    <div className={styles.container}>
      <div className={styles.logList}>
        {logs.map((log, index) => (
          <div key={index} className={styles.logEntry}>
            <span className={styles.timestamp}>{log.timestamp}</span>
            <span className={styles.platform}>{log.platform}</span>
            <span className={`${styles.content} ${styles[log.color]}`}>
              {log.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActivityLog;
