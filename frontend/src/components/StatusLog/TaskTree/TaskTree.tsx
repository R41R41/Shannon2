import React, { useState, useEffect } from "react";
import styles from "./TaskTree.module.scss";
import { TaskTreeState } from "@common/types/taskGraph";
import { PlanningAgent } from "@/services/agents/planningAgent";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import classNames from "classnames";

interface TaskTreeProps {
  planning: PlanningAgent | null;
  isMobile?: boolean;
}

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case "completed":
      return <CheckCircleOutlineIcon className={classNames(styles.statusIcon, styles.completed)} />;
    case "error":
      return <ErrorOutlineIcon className={classNames(styles.statusIcon, styles.error)} />;
    case "in_progress":
      return <AutorenewIcon className={classNames(styles.statusIcon, styles.inProgress)} />;
    default:
      return <HourglassEmptyIcon className={classNames(styles.statusIcon, styles.pending)} />;
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    case "in_progress":
      return "In Progress";
    default:
      return "Pending";
  }
};

const TaskTree: React.FC<TaskTreeProps> = ({ planning, isMobile }) => {
  const [taskTree, setTaskTree] = useState<TaskTreeState | null>(null);

  useEffect(() => {
    if (planning) {
      planning.onUpdatePlanning((taskTree) => {
        setTaskTree(taskTree);
      });
    }
  }, [planning]);

  const hasData = taskTree && taskTree.goal;

  return (
    <div className={classNames(styles.card, { [styles.mobile]: isMobile })}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>Planning</span>
        {taskTree?.status && (
          <span
            className={classNames(styles.statusBadge, styles[taskTree.status])}
          >
            {statusLabel(taskTree.status)}
          </span>
        )}
      </div>

      {hasData ? (
        <div className={styles.content}>
          <div className={styles.goalSection}>
            <StatusIcon status={taskTree.status ?? "pending"} />
            <span className={styles.goalText}>{taskTree.goal}</span>
          </div>

          {taskTree.strategy && (
            <div className={styles.strategyText}>{taskTree.strategy}</div>
          )}

          {taskTree.error && (
            <div className={styles.errorBox}>
              <ErrorOutlineIcon className={styles.errorIcon} />
              <span>{taskTree.error}</span>
            </div>
          )}

          {taskTree.subTasks && taskTree.subTasks.length > 0 && (
            <div className={styles.subTaskList}>
              {taskTree.subTasks.map((subTask, index) => (
                <div
                  key={`${subTask.subTaskGoal}-${index}`}
                  className={styles.subTaskItem}
                >
                  <StatusIcon status={subTask.subTaskStatus} />
                  <div className={styles.subTaskContent}>
                    <span className={styles.subTaskGoal}>
                      {subTask.subTaskGoal}
                    </span>
                    {subTask.subTaskStrategy && (
                      <span className={styles.subTaskStrategy}>
                        {subTask.subTaskStrategy}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <HourglassEmptyIcon className={styles.emptyIcon} />
          <span>タスクなし</span>
        </div>
      )}
    </div>
  );
};

export default TaskTree;
