import { StatusAgent } from "@/services/agents/statusAgent";
import { ConnectionStatus } from "@/services/common/WebSocketClient";
import { ServiceStatus } from "@common/types/common";
import { UserInfo } from "@common/types/web";
import React, { useEffect, useState } from "react";
import { MinebotBotItem } from "../MinebotBotItem/MinebotBotItem";
import { ServiceItem } from "../ServiceItem/ServiceItem";
import styles from "./StatusTab.module.scss";

interface StatusTabProps {
  status: StatusAgent | null;
  userInfo?: UserInfo | null;
  isTest?: boolean;
}

interface ServiceStatuses {
  [key: string]: ServiceStatus;
}

// Service definitions with categories
const SERVICE_CATEGORIES = [
  {
    label: "Social",
    services: [
      { id: "twitter", name: "Twitter Bot" },
      { id: "discord", name: "Discord Bot" },
      { id: "youtube", name: "YouTube Bot" },
      { id: "youtube:live_chat", name: "YouTube Live Chat" },
    ],
  },
  {
    label: "Minecraft",
    services: [
      { id: "minecraft", name: "Minecraft Client" },
      { id: "minecraft:1.21.11-fabric-youtube", name: "MC 1.21.11-fabric-youtube" },
      { id: "minecraft:1.19.0-youtube", name: "MC 1.19.0-youtube" },
      { id: "minecraft:1.21.4-test", name: "MC 1.21.4-test" },
      { id: "minecraft:1.21.1-play", name: "MC 1.21.1-play" },
      { id: "minecraft:1.21.11-fabric-test", name: "MC 1.21.11-fabric-test" },
    ],
  },
  {
    label: "Minebot",
    services: [
      { id: "minebot", name: "Minebot Client" },
      // minebot:bot is handled separately (MinebotBotItem)
    ],
  },
];

const ALL_SERVICE_IDS: string[] = [
  ...SERVICE_CATEGORIES.flatMap((cat) => cat.services.map((s) => s.id)),
  "minebot:bot",
];

const INITIAL_STATUSES: ServiceStatuses = Object.fromEntries(
  ALL_SERVICE_IDS.map((id) => [id, "stopped" as ServiceStatus])
);

export const StatusTab: React.FC<StatusTabProps> = ({
  status,
  userInfo,
  isTest,
}) => {
  const [serviceStatuses, setServiceStatuses] =
    useState<ServiceStatuses>(INITIAL_STATUSES);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  // Track WebSocket connection for re-fetch on reconnect
  useEffect(() => {
    if (!status) return;
    const listener = (newStatus: ConnectionStatus) =>
      setConnectionStatus(newStatus);
    status.addStatusListener(listener);
    setConnectionStatus(status.status);
    return () => status.removeStatusListener(listener);
  }, [status]);

  // Fetch service statuses on connect/reconnect
  useEffect(() => {
    if (!status || connectionStatus !== "connected") return;

    ALL_SERVICE_IDS.forEach((service) => {
      status.getStatusService(service);
    });

    const cleanupFunctions = ALL_SERVICE_IDS.map((service) => {
      return status.onServiceStatus(service, (newStatus) => {
        setServiceStatuses((prev) => ({ ...prev, [service]: newStatus }));
      });
    });

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [status, connectionStatus]);

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

  const isAdmin = userInfo?.isAdmin || isTest;

  return (
    <div className={styles.container}>
      <span className={styles.title}>Services</span>

      {isAdmin && (
        <div className={styles.categoryList}>
          {SERVICE_CATEGORIES.map((category) => (
            <div key={category.label} className={styles.category}>
              <span className={styles.categoryLabel}>{category.label}</span>
              <div className={styles.serviceList}>
                {category.services.map((service) => (
                  <ServiceItem
                    key={service.id}
                    name={service.name}
                    status={serviceStatuses[service.id]}
                    serviceId={service.id}
                    statusAgent={status}
                    onToggle={handleToggle}
                  />
                ))}
                {category.label === "Minebot" && (
                  <MinebotBotItem
                    status={serviceStatuses["minebot:bot"]}
                    onToggle={handleToggle}
                    onServerSelect={handleMinebotBotStart}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isAdmin && (
        <div className={styles.categoryList}>
          <div className={styles.category}>
            <div className={styles.serviceList}>
              <ServiceItem
                name="Minecraft 1.21.1-play"
                status={serviceStatuses["minecraft:1.21.1-play"]}
                serviceId="minecraft:1.21.1-play"
                statusAgent={status}
                onToggle={handleToggle}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusTab;
