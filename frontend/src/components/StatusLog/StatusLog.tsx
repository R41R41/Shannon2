import React, { useState, useEffect } from 'react';
import styles from './StatusLog.module.scss';
import { ConnectionStatus } from '@/services/common/WebSocketClient';
import CircleIcon from '@mui/icons-material/Circle';
import { MonitoringAgent } from '@/services/agents/monitoringAgent';
import { OpenAIAgent } from '@/services/agents/openaiAgent';
import { StatusAgent } from '@/services/agents/statusAgent';

interface StatusLogProps {
  monitoring: MonitoringAgent | null;
  openai: OpenAIAgent | null;
  status: StatusAgent | null;
}

const StatusLog: React.FC<StatusLogProps> = ({
  monitoring,
  openai,
  status,
}) => {
  const [monitoringStatus, setMonitoringStatus] =
    useState<ConnectionStatus>('disconnected');
  const [openaiStatus, setOpenaiStatus] =
    useState<ConnectionStatus>('disconnected');
  const [statusStatus, setStatusStatus] =
    useState<ConnectionStatus>('disconnected');

  useEffect(() => {
    const updateMonitoringStatus = (status: ConnectionStatus) => {
      setMonitoringStatus(status);
    };
    const updateOpenaiStatus = (status: ConnectionStatus) => {
      setOpenaiStatus(status);
    };

    const updateStatusStatus = (status: ConnectionStatus) => {
      setStatusStatus(status);
    };

    monitoring?.addStatusListener(updateMonitoringStatus);
    openai?.addStatusListener(updateOpenaiStatus);
    status?.addStatusListener(updateStatusStatus);
    return () => {
      monitoring?.removeStatusListener(updateMonitoringStatus);
      openai?.removeStatusListener(updateOpenaiStatus);
      status?.removeStatusListener(updateStatusStatus);
    };
  }, [monitoring, openai, status]);

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
        <CircleIcon className={getStatusColor(statusStatus)} />
        <span>StatusMonitor</span>
        <span className={styles.statusText}>{getStatusText(statusStatus)}</span>
      </div>
    </div>
  );
};

export default StatusLog;
