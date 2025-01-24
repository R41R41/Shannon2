import React, { useState } from 'react';
import styles from './Sidebar.module.scss';
import classNames from 'classnames';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import HandymanOutlinedIcon from '@mui/icons-material/HandymanOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';

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
          <SearchOutlinedIcon />
        </div>
        <div 
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'skills'
          })}
          onClick={() => setActiveTab('skills')}
        >
          <HandymanOutlinedIcon />
        </div>
        <div 
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'tasks'
          })}
          onClick={() => setActiveTab('tasks')}
        >
          <TaskAltOutlinedIcon />
        </div>
        <div 
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'schedule'
          })}
          onClick={() => setActiveTab('schedule')}
        >
          <ScheduleOutlinedIcon />
        </div>
      </div>
      <div className={styles.tabContent}>
        {activeTab === 'search' && <div></div>}
        {activeTab === 'skills' && <div></div>}
        {activeTab === 'tasks' && <div></div>}
        {activeTab === 'schedule' && <div></div>}
      </div>
    </div>
  );
};

export default Sidebar;