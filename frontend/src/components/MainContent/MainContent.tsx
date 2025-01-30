import React from 'react';
import styles from './MainContent.module.scss';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import ActivityLog from '@/components/ActivityLog/ActivityLog';
import StatusLog from '@/components/StatusLog/StatusLog';
import { ConnectionStatus } from '@/services/monitoring';

interface MainContentProps {
  monitoringStatus: ConnectionStatus;
  openaiStatus: ConnectionStatus;
  webStatus: ConnectionStatus;
}

const ResizeHandle = () => (
  <PanelResizeHandle className={styles.resizeHandle} />
);

const MainContent: React.FC<MainContentProps> = ({
  monitoringStatus,
  openaiStatus,
  webStatus,
}) => {
  return (
    <div className={styles.container}>
      <PanelGroup direction="vertical">
        <Panel defaultSize={40} minSize={20}>
          <StatusLog
            monitoringStatus={monitoringStatus}
            openaiStatus={openaiStatus}
            webStatus={webStatus}
          />
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={60} minSize={30}>
          <ActivityLog monitoringStatus={monitoringStatus} />
        </Panel>
      </PanelGroup>
    </div>
  );
};

export default MainContent;
