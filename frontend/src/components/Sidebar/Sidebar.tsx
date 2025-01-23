import React, { useState } from 'react';
import styles from './Sidebar.module.scss';
import classNames from 'classnames';

const Sidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState('search');

  return (
    <div className={styles.sidebarContainer}>
      <div className={styles.tabContainer}>
        <div 
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'search'
          })}
          onClick={() => setActiveTab('search')}
        >
          検索
        </div>
        <div 
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'skills'
          })}
          onClick={() => setActiveTab('skills')}
        >
          スキル
        </div>
        <div 
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'tasks'
          })}
          onClick={() => setActiveTab('tasks')}
        >
          タスク
        </div>
      </div>
      <div className={styles.tabContent}>
        {/* タブコンテンツをここに実装 */}
      </div>
    </div>
  );
};

export default Sidebar;