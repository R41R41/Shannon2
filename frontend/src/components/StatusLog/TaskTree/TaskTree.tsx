import React, { useState, useEffect } from 'react';
import styles from './TaskTree.module.scss';
import { TaskTreeState } from '@common/types';
import { PlanningAgent } from '@/services/agents/planningAgent';

interface TaskTreeProps {
  planning: PlanningAgent | null;
}

const TaskTree: React.FC<TaskTreeProps> = ({ planning }) => {
  const [taskTree, setTaskTree] = useState<TaskTreeState | null>(null);

  useEffect(() => {
    if (planning) {
      planning.onUpdatePlanning((taskTree) => {
        setTaskTree(taskTree);
      });
    }
  }, [planning]);

  return (
    <div className={styles.taskTree}>
        <h4>タスク1</h4>
        <div className={styles.taskStatus}>
          <span>Status: </span>
          <span className={styles[taskTree?.status ?? 'pending']}>
            {taskTree?.status ?? 'pending'}
          </span>
        </div>
        <div className={styles.taskGoal}>
          <span>Goal: </span>
          <span>{taskTree?.goal ?? '-'}</span>
        </div>
        <div className={styles.taskPlan}>
          <span>Strategy: </span>
          <span>{taskTree?.strategy ?? '-'}</span>
        </div>
        {taskTree?.error && (
          <div className={styles.taskError}>
            <span>Error: </span>
            <span>{taskTree.error}</span>
          </div>
        )}
        {taskTree?.subTasks && taskTree.subTasks.length > 0 && (
          <div className={styles.subTasks}>
            <span>SubTasks: </span>
            <ul>
              {taskTree.subTasks.map((subTask, index) => (
                <li key={index}>
                  <span className={styles[subTask.status]}>{subTask.status}</span>
                  : {subTask.goal}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
  );
};

export default TaskTree;
