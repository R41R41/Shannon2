import React from 'react';
import styles from './MainContent.module.scss';

const MainContent: React.FC = () => {
  return (
    <div className={styles.container}>
      <div className={styles.statusSection}>
        {/* ステータスモニターとタスクツリーを実装 */}
      </div>
      <div className={styles.logSection}>
        {/* アクティビティログを実装 */}
      </div>
    </div>
  );
};

export default MainContent;