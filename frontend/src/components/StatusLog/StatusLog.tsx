import React from "react";
import styles from "./StatusLog.module.scss";
import { PlanningAgent } from "@/services/agents/planningAgent";
import TaskTree from "./TaskTree/TaskTree";
import { EmotionAgent } from "@/services/agents/emotionAgent";
import Emotion from "./Emotion/Emotion";
import classNames from "classnames";

interface StatusLogProps {
  planning: PlanningAgent | null;
  emotion: EmotionAgent | null;
  isMobile?: boolean;
}

const StatusLog: React.FC<StatusLogProps> = ({
  planning,
  emotion,
  isMobile = false,
}) => {
  return (
    <div
      className={classNames(styles.container, {
        [styles.mobile]: isMobile,
      })}
    >
      <div className={styles.panelGrid}>
        <TaskTree planning={planning} isMobile={isMobile} />
        <Emotion emotion={emotion} isMobile={isMobile} />
      </div>
    </div>
  );
};

export default StatusLog;
