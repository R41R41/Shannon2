import React, { useState, useEffect } from 'react';
import { Schedule } from '@common/types';
import { SchedulerAgent } from '@/services/agents/schedulerAgent';
import styles from './ScheduleTab.module.scss';
import cronstrue from 'cronstrue';
import ja from 'cronstrue/locales/ja';

interface ScheduleTabProps {
  scheduler: SchedulerAgent | null;
}

const ScheduleTab: React.FC<ScheduleTabProps> = ({ scheduler }) => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => {
    if (scheduler?.status === 'connected') {
      const fetchAllSchedules = async () => {
        try {
          const schedules = await scheduler?.getAllSchedules();
          if (schedules) {
            setSchedules(schedules);
          }
        } catch (error) {
          console.error('Failed to fetch schedules:', error);
        }
      };

      fetchAllSchedules();
    }
  }, [scheduler]);

  const handleExecute = async (name: string) => {
    if (scheduler) {
      await scheduler.callSchedule(name);
    }
  };

  return (
    <div className={styles.container}>
      <span className={styles.title}>Schedules</span>
      <div className={styles.scheduleList}>
        {schedules.map((schedule) => (
          <div key={schedule.name} className={styles.scheduleItem}>
            <div className={styles.info}>
              <span className={styles.name}>{schedule.name}</span>
              <span className={styles.time}>
                {cronstrue.toString(schedule.time, {
                  locale: ja,
                  verbose: true,
                  use24HourTimeFormat: true,
                })}
              </span>
            </div>
            <button
              className={styles.executeButton}
              onClick={() => handleExecute(schedule.name)}
            >
              実行
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScheduleTab;
