import React from "react";
import { ServiceStatus } from "@common/types/common";
import { StatusAgent } from "@/services/agents/statusAgent";
import styles from "./ServiceItem.module.scss";
import classNames from "classnames";

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
}) => {
  const isRunning = status === "running";
  const isConnecting = status === "connecting";

  return (
    <div
      className={classNames(styles.serviceItem, {
        [styles.stopped]: !isRunning && !isConnecting,
      })}
    >
      <div className={styles.info}>
        <span className={styles.name}>{name}</span>
        <span className={classNames(styles.statusText, styles[status])}>
          <span className={styles.statusDot} />
          {status}
        </span>
      </div>

      <button
        className={classNames(styles.toggle, {
          [styles.active]: isRunning,
        })}
        onClick={() => onToggle(serviceId)}
        disabled={isConnecting}
        title={isRunning ? "停止" : "起動"}
      >
        <span className={styles.toggleThumb} />
      </button>
    </div>
  );
};
