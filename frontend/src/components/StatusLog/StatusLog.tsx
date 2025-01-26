import React, { useState, useEffect } from 'react';
import styles from './StatusLog.module.scss';
import MonitoringService, { ConnectionStatus } from '@/services/monitoring';
import CircleIcon from '@mui/icons-material/Circle';

const StatusLog: React.FC = () => {
  const [webStatus, setWebStatus] = useState<ConnectionStatus>('disconnected');

  useEffect(() => {
    const monitoring = MonitoringService();
    const unsubscribeWeb = monitoring.onWebStatusChange(setWebStatus);

    return () => {
      unsubscribeWeb();
    };
  }, []);

  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case 'connected':
        return styles.connected;
      case 'connecting':
        return styles.connecting;
      case 'disconnected':
        return styles.disconnected;
    }
  };

  const getStatusText = (status: ConnectionStatus) => {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.status}>
        <CircleIcon className={getStatusColor(webStatus)} />
        <span>Web Client: {getStatusText(webStatus)}</span>
      </div>
    </div>
  );
};

export default StatusLog;
