import { EventType, MemoryZone, ServiceInput } from "./common";
import { TwitterClientInput } from "./twitter";
export interface Schedule {
    time: string;
    name: string;
    data: {
        type: EventType;
        memoryZone: MemoryZone;
        data: TwitterClientInput;
        targetMemoryZones: MemoryZone[];
    };
}
export type ScheduleInputType = "get_schedule" | "call_schedule";
export interface SchedulerInput extends ServiceInput {
    type: ScheduleInputType;
    name: string;
}
export interface SchedulerOutput {
    type: "post_schedule";
    data: Schedule[];
}
export type SchedulerEventType = "scheduler:call_schedule" | "scheduler:get_schedule";
