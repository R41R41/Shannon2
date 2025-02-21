import React from 'react';
import { ServiceStatus } from '@common/types/common';
import { StatusAgent } from '@/services/agents/statusAgent';
import styles from './ServiceItem.module.scss';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';

interface ServiceItemProps {
  name: string;
  status: ServiceStatus;
  serviceId: string;
  statusAgent: StatusAgent | null;
  onToggle: (serviceId: string) => void;
}

export const ServiceItem: React.FC<ServiceItemProps> = ({
  name,
  status,
  serviceId,
  onToggle,
}) => (
  <div className={styles.serviceItem}>
    <div className={styles.info}>
      <span className={styles.name}>{name}</span>
      <span className={`${styles.status} ${styles[status]}`}>
        {status}
      </span>
    </div>
    <button
      className={`${styles.toggleButton} ${
        status === 'stopped' ? styles.start : styles.stop
      }`}
      onClick={() => onToggle(serviceId)}
      disabled={status === 'connecting'}
    >
      {status === 'running' ? <StopIcon /> : <PlayArrowIcon />}
    </button>
  </div>
); 