// プロジェクトのルートレベルで型定義
declare module 'mineflayer-projectile';
declare module 'mineflayer-pvp';
declare module 'mineflayer-tool';
declare module 'minecrafthawkeye';

declare module 'wolfram-alpha-api' {
  interface WolframAlphaAPI {
    getShort(query: string): Promise<string>;
    getSimple(query: string): Promise<string>;
    getFull(query: string): Promise<string>;
    getSpoken(query: string): Promise<string>;
  }

  function WolframAlphaAPI(appid: string): WolframAlphaAPI;
  export default WolframAlphaAPI;
}
