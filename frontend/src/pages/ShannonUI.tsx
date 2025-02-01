import React, { useState, useEffect } from 'react';
import styles from './ShannonUI.module.scss';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Sidebar from '@components/Sidebar/Sidebar';
import MainContent from '@components/MainContent/MainContent';
import ChatView from '@components/ChatView/ChatView';
import Header from '@components/Header/Header';
import { MonitoringAgent } from '@/services/agents/monitoringAgent';
import { OpenAIAgent } from '@/services/agents/openaiAgent';
import { WebClient } from '@/services/client';
import { SchedulerAgent } from '@/services/agents/schedulerAgent';
const ResizeHandle = ({ className = '' }) => (
  <PanelResizeHandle className={`${styles.resizeHandle} ${className}`} />
);

const ShannonUI: React.FC = () => {
  const [monitoring, setMonitoring] = useState<MonitoringAgent | null>(null);
  const [openai, setOpenai] = useState<OpenAIAgent | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerAgent | null>(null);
  useEffect(() => {
    const webClient = new WebClient();
    webClient.start();
    setMonitoring(webClient.monitoringService);
    setOpenai(webClient.openaiService);
    setScheduler(webClient.schedulerService);
  }, []);
  return (
    <div className={styles.container}>
      <Header />
      <div className={styles.mainSection}>
        <PanelGroup direction="horizontal">
          <Panel defaultSize={20} minSize={15}>
            <Sidebar monitoring={monitoring} scheduler={scheduler} />
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={60} minSize={30}>
            <MainContent monitoring={monitoring} openai={openai} />
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={20} minSize={15}>
            <ChatView openai={openai} />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
};

export default ShannonUI;
