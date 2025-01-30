import React from 'react';
import styles from './StatusLog.module.scss';
import { ConnectionStatus } from '@/services/monitoring';
import CircleIcon from '@mui/icons-material/Circle';

interface StatusLogProps {
  monitoringStatus: ConnectionStatus;
  openaiStatus: ConnectionStatus;
  webStatus: ConnectionStatus;
}

const StatusLog: React.FC<StatusLogProps> = ({
  monitoringStatus,
  openaiStatus,
  webStatus,
}) => {
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
        <CircleIcon className={getStatusColor(monitoringStatus)} />
        <span>Monitoring</span>
        <span className={styles.statusText}>
          {getStatusText(monitoringStatus)}
        </span>
      </div>
      <div className={styles.status}>
        <CircleIcon className={getStatusColor(openaiStatus)} />
        <span>OpenAI</span>
        <span className={styles.statusText}>{getStatusText(openaiStatus)}</span>
      </div>
      <div className={styles.status}>
        <CircleIcon className={getStatusColor(webStatus)} />
        <span>Web Client</span>
        <span className={styles.statusText}>{getStatusText(webStatus)}</span>
      </div>
    </div>
  );
};

export default StatusLog;
