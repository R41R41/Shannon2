import React, { useState, useEffect } from "react";
import styles from "./ShannonUI.module.scss";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Sidebar from "@components/Sidebar/Sidebar";
import MainContent from "@components/MainContent/MainContent";
import ChatView from "@components/ChatView/ChatView";
import Header from "@components/Header/Header";
import { MonitoringAgent } from "@/services/agents/monitoringAgent";
import { OpenAIAgent } from "@/services/agents/openaiAgent";
import { WebClient } from "@/services/client";
import { SchedulerAgent } from "@/services/agents/schedulerAgent";
import { StatusAgent } from "@/services/agents/statusAgent";
import { PlanningAgent } from "@/services/agents/planningAgent";
import { EmotionAgent } from "@/services/agents/emotionAgent";
import { SkillAgent } from "@/services/agents/skillAgent";
import { UserInfo } from "@common/types/web";

const ResizeHandle = ({ direction = "vertical" }: { direction?: "vertical" | "horizontal" }) => (
  <PanelResizeHandle
    className={direction === "vertical" ? styles.resizeHandleV : styles.resizeHandleH}
  />
);

interface ShannonUIProps {
  isTest?: boolean;
}

const ShannonUI: React.FC<ShannonUIProps> = ({ isTest }) => {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringAgent | null>(null);
  const [openai, setOpenai] = useState<OpenAIAgent | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerAgent | null>(null);
  const [status, setStatus] = useState<StatusAgent | null>(null);
  const [planning, setPlanning] = useState<PlanningAgent | null>(null);
  const [emotion, setEmotion] = useState<EmotionAgent | null>(null);
  const [skill, setSkill] = useState<SkillAgent | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const storedUserInfo = localStorage.getItem("userInfo");
    if (storedUserInfo) {
      setUserInfo(JSON.parse(storedUserInfo));
    }

    const webClient = WebClient.getInstance();
    setMonitoring(webClient.monitoringService);
    setOpenai(webClient.openaiService);
    setScheduler(webClient.schedulerService);
    setStatus(webClient.statusService);
    setPlanning(webClient.planningService);
    setEmotion(webClient.emotionService);
    setSkill(webClient.skillService);

    if (!webClient.isConnected()) {
      webClient.start();
    }

    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className={styles.container}>
      <Header
        userInfo={userInfo}
        monitoring={monitoring}
        openai={openai}
        status={status}
      />
      <div className={styles.mainSection}>
        {isMobile ? (
          <div className={styles.mobileLayout}>
            <div className={styles.mobileContent}>
              <MainContent
                monitoring={monitoring}
                openai={openai}
                status={status}
                planning={planning}
                emotion={emotion}
                isMobile={true}
              />
            </div>
            <div className={styles.mobileChatView}>
              <ChatView openai={openai} userInfo={userInfo} />
            </div>
            <div className={styles.mobileNavbar}>
              <Sidebar
                monitoring={monitoring}
                scheduler={scheduler}
                status={status}
                skill={skill}
                isMobile={true}
                userInfo={userInfo}
                isTest={isTest}
              />
            </div>
          </div>
        ) : (
          <PanelGroup direction="horizontal">
            <Panel defaultSize={18} minSize={14}>
              <Sidebar
                monitoring={monitoring}
                scheduler={scheduler}
                status={status}
                skill={skill}
                userInfo={userInfo}
                isTest={isTest}
              />
            </Panel>
            <ResizeHandle direction="horizontal" />
            <Panel defaultSize={62} minSize={30}>
              <MainContent
                monitoring={monitoring}
                openai={openai}
                status={status}
                planning={planning}
                emotion={emotion}
              />
            </Panel>
            <ResizeHandle direction="horizontal" />
            <Panel defaultSize={20} minSize={15}>
              <ChatView openai={openai} userInfo={userInfo} />
            </Panel>
          </PanelGroup>
        )}
      </div>
    </div>
  );
};

export default ShannonUI;
