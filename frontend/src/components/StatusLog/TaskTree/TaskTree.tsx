import React, { useState, useEffect } from "react";
import styles from "./TaskTree.module.scss";
import { TaskTreeState } from "@common/types/taskGraph";
import { PlanningAgent } from "@/services/agents/planningAgent";

interface TaskTreeProps {
  planning: PlanningAgent | null;
  isMobile?: boolean;
}

const TaskTree: React.FC<TaskTreeProps> = ({ planning, isMobile }) => {
  const [taskTree, setTaskTree] = useState<TaskTreeState | null>(null);

  useEffect(() => {
    if (planning) {
      planning.onUpdatePlanning((taskTree) => {
        setTaskTree(taskTree);
      });
    }
  }, [planning]);

  return (
    <div className={`${styles.taskTree} ${isMobile ? styles.mobile : ""}`}>
      <div className={styles.plan}>
        <div className={styles.taskTitle}>
          <div
            className={`${styles.status} ${
              styles[taskTree?.status ?? "pending"]
            }`}
          ></div>
          <div>{taskTree?.goal ?? "-"}</div>
        </div>
        <div className={styles.taskPlan}>
          <span>{taskTree?.strategy ?? "-"}</span>
        </div>
        {taskTree?.error && (
          <div className={styles.taskError}>
            <span>Error: </span>
            <span>{taskTree.error}</span>
          </div>
        )}
        {taskTree?.subTasks && taskTree.subTasks.length > 0 && (
          <div className={styles.subTasks}>
            <ul>
              {taskTree.subTasks.map((subTask, index) => (
                <div
                  key={`${subTask.subTaskGoal}-${index}`}
                  className={styles.subTask}
                >
                  <div className={styles.subTaskTitle}>
                    <div
                      className={`${styles.status} ${
                        styles[subTask.subTaskStatus]
                      }`}
                    ></div>
                    <div>{subTask.subTaskGoal}</div>
                  </div>
                  <div className={styles.subTaskStrategy}>
                    {subTask.subTaskStrategy}
                  </div>
                </div>
              ))}
            </ul>
          </div>
        )}
      </div>
      {!isMobile && (
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <div
              className={`${styles.status} ${styles.pending} ${styles.stop}`}
            ></div>
            <div className={styles.legendItemText}>Pending</div>
          </div>
          <div className={styles.legendItem}>
            <div
              className={`${styles.status} ${styles.in_progress} ${styles.stop}`}
            ></div>
            <div className={styles.legendItemText}>In Progress</div>
          </div>
          <div className={styles.legendItem}>
            <div
              className={`${styles.status} ${styles.completed} ${styles.stop}`}
            ></div>
            <div className={styles.legendItemText}>Completed</div>
          </div>
          <div className={styles.legendItem}>
            <div
              className={`${styles.status} ${styles.error} ${styles.stop}`}
            ></div>
            <div className={styles.legendItemText}>Error</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskTree;
