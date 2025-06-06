import React, { useState } from "react";
import styles from "./Header.module.scss";
import SettingsModal from "@components/Modal/SettingsModal";
import logo from "@/assets/logo.png";
import SettingsIcon from "@mui/icons-material/Settings";
import { UserInfo } from "@common/types/web";

interface HeaderProps {
  userInfo?: UserInfo | null;
}

const Header: React.FC<HeaderProps> = ({ userInfo }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.leftSection}>
          <img src={logo} alt="Shannon Logo" className={styles.logo} />
          <div className={styles.version}>SHANNON-v2.2</div>
        </div>

        <div className={styles.rightSection}>
          <button
            className={styles.settingsButton}
            onClick={() => setIsModalOpen(true)}
          >
            <SettingsIcon />
          </button>
        </div>
        <div className={styles.dentSection}>
          <div className={`${styles.triangle} ${styles.leftTriangle}`}></div>
          <div className={styles.rectangle}></div>
          <div className={`${styles.triangle} ${styles.rightTriangle}`}></div>
        </div>
        <div className={styles.userInfo}>
          <div className={styles.userName}>{userInfo?.name}</div>
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
