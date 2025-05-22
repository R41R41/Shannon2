import React, { useState, useEffect } from "react";
import { ServiceStatus } from "@common/types/common";
import { StatusAgent } from "@/services/agents/statusAgent";
import { ServiceItem } from "../ServiceItem/ServiceItem";
import { MinebotBotItem } from "../MinebotBotItem/MinebotBotItem";
import styles from "./StatusTab.module.scss";
import { UserInfo } from "@common/types/web";

interface StatusTabProps {
  status: StatusAgent | null;
  userInfo?: UserInfo | null;
}

interface ServiceStatuses {
  [key: string]: ServiceStatus;
}

const SERVICES = [
  "twitter",
  "discord",
  "youtube",
  "minecraft",
  "minecraft:1.19.0-youtube",
  "minecraft:1.21.4-test",
  "minecraft:1.21.1-play",
  "minebot",
  "minebot:bot",
] as const;

export const StatusTab: React.FC<StatusTabProps> = ({ status, userInfo }) => {
  const [serviceStatuses, setServiceStatuses] = useState<ServiceStatuses>({
    twitter: "stopped",
    discord: "stopped",
    youtube: "stopped",
    minecraft: "stopped",
    "minecraft:1.19.0-youtube": "stopped",
    "minecraft:1.21.4-test": "stopped",
    "minecraft:1.21.1-play": "stopped",
    minebot: "stopped",
    "minebot:bot": "stopped",
  });

  useEffect(() => {
    if (status?.status === "connected") {
      SERVICES.forEach((service) => {
        status.getStatusService(service);
      });

      const cleanupFunctions = SERVICES.map((service) => {
        return status.onServiceStatus(service, (newStatus) => {
          setServiceStatuses((prev) => ({ ...prev, [service]: newStatus }));
        });
      });

      return () => {
        cleanupFunctions.forEach((cleanup) => cleanup());
      };
    }
  }, [status]);

  const handleToggle = async (service: string) => {
    if (!status) return;
    const serviceStatus = serviceStatuses[service];

    if (serviceStatus === "running") {
      await status.stopService(service);
    } else if (service !== "minebot:bot") {
      await status.startService(service);
    }
  };

  const handleMinebotBotStart = async (serverName: string) => {
    await status?.startService("minebot:bot", { serverName });
  };

  return (
    <div className={styles.container}>
      <span className={styles.title}>Service Status</span>
      <div className={styles.serviceList}>
        {userInfo?.isAdmin && (
          <>
            <ServiceItem
              name="Twitter Bot"
              status={serviceStatuses["twitter"]}
              serviceId="twitter"
              statusAgent={status}
              onToggle={handleToggle}
            />
            <ServiceItem
              name="Discord Bot"
              status={serviceStatuses["discord"]}
              serviceId="discord"
              statusAgent={status}
              onToggle={handleToggle}
            />
            <ServiceItem
              name="YouTube Bot"
              status={serviceStatuses["youtube"]}
              serviceId="youtube"
              statusAgent={status}
              onToggle={handleToggle}
            />
            <ServiceItem
              name="Minecraft Client"
              status={serviceStatuses["minecraft"]}
              serviceId="minecraft"
              statusAgent={status}
              onToggle={handleToggle}
            />
            <ServiceItem
              name="Minecraft 1.19.0-youtube"
              status={serviceStatuses["minecraft:1.19.0-youtube"]}
              serviceId="minecraft:1.19.0-youtube"
              statusAgent={status}
              onToggle={handleToggle}
            />
            <ServiceItem
              name="Minecraft 1.21.4-test"
              status={serviceStatuses["minecraft:1.21.4-test"]}
              serviceId="minecraft:1.21.4-test"
              statusAgent={status}
              onToggle={handleToggle}
            />
            <ServiceItem
              name="Minecraft 1.21.1-play"
              status={serviceStatuses["minecraft:1.21.1-play"]}
              serviceId="minecraft:1.21.1-play"
              statusAgent={status}
              onToggle={handleToggle}
            />
            <ServiceItem
              name="Minebot Client"
              status={serviceStatuses["minebot"]}
              serviceId="minebot"
              statusAgent={status}
              onToggle={handleToggle}
            />
            <MinebotBotItem
              status={serviceStatuses["minebot:bot"]}
              onToggle={handleToggle}
              onServerSelect={handleMinebotBotStart}
            />
          </>
        )}
        {!userInfo?.isAdmin && (
          <>
            <ServiceItem
              name="Minecraft 1.21.1-play"
              status={serviceStatuses["minecraft:1.21.1-play"]}
              serviceId="minecraft:1.21.1-play"
              statusAgent={status}
              onToggle={handleToggle}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default StatusTab;
