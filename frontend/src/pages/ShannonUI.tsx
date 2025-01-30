import React, { useState, useEffect } from 'react';
import styles from './ShannonUI.module.scss';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Sidebar from '@components/Sidebar/Sidebar';
import MainContent from '@components/MainContent/MainContent';
import ChatView from '@components/ChatView/ChatView';
import Header from '@components/Header/Header';
import MonitoringService, { ConnectionStatus } from '@/services/monitoring';
import OpenAIService from '@/services/openai';
const ResizeHandle = ({ className = '' }) => (
  <PanelResizeHandle className={`${styles.resizeHandle} ${className}`} />
);

const ShannonUI: React.FC = () => {
  const [monitoringStatus, setMonitoringStatus] =
    useState<ConnectionStatus>('disconnected');
  const [openaiStatus, setOpenAIStatus] =
    useState<ConnectionStatus>('disconnected');
  const [webStatus, setWebStatus] = useState<ConnectionStatus>('disconnected');
  useEffect(() => {
    const monitoring = MonitoringService();
    const openai = OpenAIService();

    const unsubscribeMonitoring =
      monitoring.onWebStatusChange(setMonitoringStatus);
    const unsubscribeOpenAI = openai.onStatusChange(setOpenAIStatus);
    const unsubscribeWeb = monitoring.onWebStatusChange(setWebStatus);

    return () => {
      unsubscribeMonitoring();
      unsubscribeOpenAI();
      unsubscribeWeb();
    };
  }, []);
  return (
    <div className={styles.container}>
      <Header />
      <div className={styles.mainSection}>
        <PanelGroup direction="horizontal">
          <Panel defaultSize={20} minSize={15}>
            <Sidebar />
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={60} minSize={30}>
            <MainContent
              monitoringStatus={monitoringStatus}
              openaiStatus={openaiStatus}
              webStatus={webStatus}
            />
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={20} minSize={15}>
            <ChatView />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
};

export default ShannonUI;
