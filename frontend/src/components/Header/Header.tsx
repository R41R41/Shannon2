import React, { useState, useEffect } from "react";
import styles from "./Header.module.scss";
import SettingsModal from "@components/Modal/SettingsModal";
import logo from "@/assets/logo.png";
import SettingsIcon from "@mui/icons-material/Settings";
import { UserInfo } from "@common/types/web";
import { ConnectionStatus } from "@/services/common/WebSocketClient";
import { MonitoringAgent } from "@/services/agents/monitoringAgent";
import { OpenAIAgent } from "@/services/agents/openaiAgent";
import { StatusAgent } from "@/services/agents/statusAgent";
import classNames from "classnames";

interface HeaderProps {
  userInfo?: UserInfo | null;
  monitoring?: MonitoringAgent | null;
  openai?: OpenAIAgent | null;
  status?: StatusAgent | null;
}

interface ConnectionIndicatorProps {
  label: string;
  status: ConnectionStatus;
}

const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({
  label,
  status,
}) => (
  <div className={styles.connectionItem} title={`${label}: ${status}`}>
    <span
      className={classNames(styles.connectionDot, {
        [styles.connected]: status === "connected",
        [styles.connecting]: status === "connecting",
        [styles.disconnected]: status === "disconnected",
      })}
    />
    <span className={styles.connectionLabel}>{label}</span>
  </div>
);

const Header: React.FC<HeaderProps> = ({
  userInfo,
  monitoring,
  openai,
  status,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [monitoringStatus, setMonitoringStatus] =
    useState<ConnectionStatus>("disconnected");
  const [openaiStatus, setOpenaiStatus] =
    useState<ConnectionStatus>("disconnected");
  const [statusStatus, setStatusStatus] =
    useState<ConnectionStatus>("disconnected");

  useEffect(() => {
    const onMonitoring = (s: ConnectionStatus) => setMonitoringStatus(s);
    const onOpenai = (s: ConnectionStatus) => setOpenaiStatus(s);
    const onStatus = (s: ConnectionStatus) => setStatusStatus(s);

    monitoring?.addStatusListener(onMonitoring);
    openai?.addStatusListener(onOpenai);
    status?.addStatusListener(onStatus);

    // Sync initial state
    if (monitoring) setMonitoringStatus(monitoring.status);
    if (openai) setOpenaiStatus(openai.status);
    if (status) setStatusStatus(status.status);

    return () => {
      monitoring?.removeStatusListener(onMonitoring);
      openai?.removeStatusListener(onOpenai);
      status?.removeStatusListener(onStatus);
    };
  }, [monitoring, openai, status]);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.leftSection}>
          <img src={logo} alt="Shannon Logo" className={styles.logo} />
          <span className={styles.version}>SHANNON-v2.2</span>
        </div>

        <div className={styles.centerSection}>
          <ConnectionIndicator label="Monitor" status={monitoringStatus} />
          <ConnectionIndicator label="OpenAI" status={openaiStatus} />
          <ConnectionIndicator label="Status" status={statusStatus} />
        </div>

        <div className={styles.rightSection}>
          {userInfo?.name && (
            <span className={styles.userName}>{userInfo.name}</span>
          )}
          <button
            className={styles.settingsButton}
            onClick={() => setIsModalOpen(true)}
            title="設定"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <SettingsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};

export default Header;
