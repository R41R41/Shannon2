import React, { useState, useEffect } from 'react';
import styles from './StatusLog.module.scss';
import MonitoringService, { ConnectionStatus } from '@/services/monitoring';
import CircleIcon from '@mui/icons-material/Circle';
import OpenAIService from '@/services/openai';

const StatusLog: React.FC = () => {
  const [monitoringStatus, setMonitoringStatus] =
    useState<ConnectionStatus>('disconnected');
  const [openaiStatus, setOpenAIStatus] =
    useState<ConnectionStatus>('disconnected');
  const [webStatus, setWebStatus] = useState<ConnectionStatus>('disconnected');

  useEffect(() => {
    const monitoring = MonitoringService();
    const openai = OpenAIService();

    const unsubscribeMonitoring =
      monitoring.onWebStatusChange(setMonitoringStatus);
    const unsubscribeOpenAI = openai.onStatusChange(setOpenAIStatus);
    const unsubscribeWeb = monitoring.onWebStatusChange(setWebStatus);

    return () => {
      unsubscribeMonitoring();
      unsubscribeOpenAI();
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
        <CircleIcon className={getStatusColor(monitoringStatus)} />
        <span>Monitoring: {getStatusText(monitoringStatus)}</span>
      </div>
      <div className={styles.status}>
        <CircleIcon className={getStatusColor(openaiStatus)} />
        <span>OpenAI: {getStatusText(openaiStatus)}</span>
      </div>
      <div className={styles.status}>
        <CircleIcon className={getStatusColor(webStatus)} />
        <span>Web Client: {getStatusText(webStatus)}</span>
      </div>
    </div>
  );
};

export default StatusLog;
