import React from 'react';
import styles from './ShannonUI.module.scss';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Sidebar from '@components/Sidebar/Sidebar';
import MainContent from '@components/MainContent/MainContent';
import ChatView from '@components/ChatView/ChatView';
import Header from '@components/Header/Header';

const ResizeHandle = ({ className = '' }) => (
  <PanelResizeHandle className={`${styles.resizeHandle} ${className}`} />
);

const ShannonUI: React.FC = () => {
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
            <MainContent />
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
