declare module 'mineflayer-cmd' {
  import { Bot } from 'mineflayer';

  export interface CommandManager {
    allowConsoleInput: boolean;
    registerCommand(
      name: string,
      usage: string,
      description: string,
      callback: (sender: string, args: string[]) => void
    ): void;
    executeCommand(sender: string, str: string): void;
    listCommands(): { name: string; usage: string; description: string }[];
  }

  export interface BotWithCmd extends Bot {
    cmd: CommandManager;
  }

  export interface PluginFunction {
    (bot: Bot): void;
    allowConsoleInput?: boolean;
  }

  export const plugin: PluginFunction;

  export function startConsoleInput(bot: BotWithCmd): void;
}
