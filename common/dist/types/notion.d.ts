import { ServiceInput } from "./common.js";
export interface NotionClientInput extends ServiceInput {
    pageId: string;
}
export interface NotionClientOutput extends ServiceInput {
    title: string;
    content: string[];
}
export type NotionEventType = "notion:status" | "notion:start" | "notion:stop" | "notion:getPageMarkdown";
