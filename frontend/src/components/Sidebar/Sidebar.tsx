import React, { useState } from 'react';
import styles from './Sidebar.module.scss';
import classNames from 'classnames';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import HandymanOutlinedIcon from '@mui/icons-material/HandymanOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import SearchTab from './SearchTab';
import { LogEntry } from '@/services/monitoring';

const Sidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState('search');
  const [searchResults, setSearchResults] = useState<LogEntry[]>([]);

  return (
    <div className={styles.sidebarContainer}>
      <div className={styles.tabContainer}>
        <div
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'search',
          })}
          onClick={() => setActiveTab('search')}
          title="検索"
        >
          <SearchOutlinedIcon />
        </div>
        <div
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'skills',
          })}
          onClick={() => setActiveTab('skills')}
          title="スキル"
        >
          <HandymanOutlinedIcon />
        </div>
        <div
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'tasks',
          })}
          onClick={() => setActiveTab('tasks')}
          title="タスク"
        >
          <TaskAltOutlinedIcon />
        </div>
        <div
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'schedule',
          })}
          onClick={() => setActiveTab('schedule')}
          title="スケジュール"
        >
          <ScheduleOutlinedIcon />
        </div>
      </div>
      <div className={styles.tabContent}>
        {activeTab === 'search' && (
          <SearchTab
            searchResults={searchResults}
            setSearchResults={setSearchResults}
          />
        )}
        {activeTab === 'skills' && <div></div>}
        {activeTab === 'tasks' && <div></div>}
        {activeTab === 'schedule' && <div></div>}
      </div>
    </div>
  );
};

export default Sidebar;
