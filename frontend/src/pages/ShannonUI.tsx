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

const ResizeHandle = ({ className = "" }) => (
  <PanelResizeHandle className={`${styles.resizeHandle} ${className}`} />
);

const ShannonUI: React.FC = () => {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringAgent | null>(null);
  const [openai, setOpenai] = useState<OpenAIAgent | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerAgent | null>(null);
  const [status, setStatus] = useState<StatusAgent | null>(null);
  const [planning, setPlanning] = useState<PlanningAgent | null>(null);
  const [emotion, setEmotion] = useState<EmotionAgent | null>(null);
  const [skill, setSkill] = useState<SkillAgent | null>(null);

  useEffect(() => {
    // ローカルストレージからユーザー情報を取得
    const storedUserInfo = localStorage.getItem("userInfo");
    if (storedUserInfo) {
      setUserInfo(JSON.parse(storedUserInfo));
    }

    const webClient = new WebClient();
    webClient.start();
    setMonitoring(webClient.monitoringService);
    setOpenai(webClient.openaiService);
    setScheduler(webClient.schedulerService);
    setStatus(webClient.statusService);
    setPlanning(webClient.planningService);
    setEmotion(webClient.emotionService);
    setSkill(webClient.skillService);
  }, []);

  return (
    <div className={styles.container}>
      <Header userInfo={userInfo} />
      <div className={styles.mainSection}>
        <PanelGroup direction="horizontal">
          <Panel defaultSize={20} minSize={15}>
            <Sidebar
              monitoring={monitoring}
              scheduler={scheduler}
              status={status}
              skill={skill}
            />
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={60} minSize={30}>
            <MainContent
              monitoring={monitoring}
              openai={openai}
              status={status}
              planning={planning}
              emotion={emotion}
            />
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={20} minSize={15}>
            <ChatView openai={openai} userInfo={userInfo} />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
};

export default ShannonUI;
