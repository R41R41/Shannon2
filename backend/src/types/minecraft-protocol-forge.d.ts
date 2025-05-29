declare module 'minecraft-protocol-forge' {
  import { Client } from 'minecraft-protocol';

  interface ForgeOptions {
    version: string;
    protocol: number;
    forgeMods: Array<{
      name: string;
      version: string;
    }>;
  }

  export function forgeHandshake(client: Client, options: ForgeOptions): void;
}
