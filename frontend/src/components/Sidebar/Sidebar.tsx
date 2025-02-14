import React, { useState } from 'react';
import styles from './Sidebar.module.scss';
import classNames from 'classnames';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import HandymanOutlinedIcon from '@mui/icons-material/HandymanOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import SearchTab from './SearchTab';
import { ILog } from '@common/types';
import { MonitoringAgent } from '@/services/agents/monitoringAgent';
import { SchedulerAgent } from '@/services/agents/schedulerAgent';
import ScheduleTab from './ScheduleTab';
import { StatusAgent } from '@/services/agents/statusAgent';
import StatusTab from './StatusTab/StatusTab';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';

interface SidebarProps {
  monitoring: MonitoringAgent | null;
  scheduler: SchedulerAgent | null;
  status: StatusAgent | null;
}

const Sidebar: React.FC<SidebarProps> = ({ monitoring, scheduler, status }) => {
  const [activeTab, setActiveTab] = useState('search');
  const [searchResults, setSearchResults] = useState<ILog[]>([]);

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
        <div
          className={classNames(styles.tab, {
            [styles.active]: activeTab === 'status',
          })}
          onClick={() => setActiveTab('status')}
          title="ステータス"
        >
          <MonitorHeartOutlinedIcon />
        </div>
      </div>
      <div className={styles.tabContent}>
        {activeTab === 'search' && (
          <SearchTab
            monitoring={monitoring}
            searchResults={searchResults}
            setSearchResults={setSearchResults}
          />
        )}
        {activeTab === 'skills' && <div></div>}
        {activeTab === 'tasks' && <div></div>}
        {activeTab === 'schedule' && <ScheduleTab scheduler={scheduler} />}
        {activeTab === 'status' && <StatusTab status={status} />}
      </div>
    </div>
  );
};

export default Sidebar;
