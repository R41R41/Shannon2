import React from 'react';
import styles from './MainContent.module.scss';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import ActivityLog from '@/components/ActivityLog/ActivityLog';
import StatusLog from '@/components/StatusLog/StatusLog';
import { MonitoringAgent } from '@/services/agents/monitoringAgent';
import { OpenAIAgent } from '@/services/agents/openaiAgent';
import { StatusAgent } from '@/services/agents/statusAgent';
import { PlanningAgent } from '@/services/agents/planningAgent';
import { EmotionAgent } from '@/services/agents/emotionAgent';
interface MainContentProps {
  monitoring: MonitoringAgent | null;
  openai: OpenAIAgent | null;
  status: StatusAgent | null;
  planning: PlanningAgent | null;
  emotion: EmotionAgent | null;
}

const ResizeHandle = () => (
  <PanelResizeHandle className={styles.resizeHandle} />
);

const MainContent: React.FC<MainContentProps> = ({
  monitoring,
  openai,
  status,
  planning,
  emotion,
}) => {
  return (
    <div className={styles.container}>
      <PanelGroup direction="vertical">
        <Panel defaultSize={40} minSize={20}>
          <StatusLog
            monitoring={monitoring}
            openai={openai}
            status={status}
            planning={planning}
            emotion={emotion}
          />
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={60} minSize={30}>
          <ActivityLog monitoring={monitoring} />
        </Panel>
      </PanelGroup>
    </div>
  );
};

export default MainContent;
