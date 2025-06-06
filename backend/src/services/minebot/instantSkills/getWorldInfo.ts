import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';

// 外部依存関係のインポート
import * as prismarineRegistry from 'prismarine-registry';
import * as prismarineChunk from 'prismarine-chunk';
import prismarineBlock from 'prismarine-block';
import prismarineBiome from 'prismarine-biome';

// Biome型を定義
interface Biome {
  id: number;
  name?: string;
}

export class GetWorldInfo extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-world-info';
    this.description =
      'botがいるワールドのバイオームや天気、時刻、難易度などの情報を取得します。';
    this.priority = 10;
    this.params = [];
  }

  async runImpl() {
    try {
      // バイオーム情報の取得
      const position = this.bot.entity.position;
      const biomeId = this.bot.world.getBiome(position);
      const biomeName = this.getBiomeName(biomeId);

      const block = this.bot.blockAt(position);
      const blockInfo = block
        ? { type: block.type, name: block.name, position: block.position }
        : null;

      const chunkInfo = {
        x: Math.floor(position.x / 16),
        z: Math.floor(position.z / 16),
        botVersion: this.bot.version || 'unknown',
        sampleBlock: blockInfo,
        apiVersion: this.bot.version,
        implementationType: 'bot-world',
      };

      // 世界の時間情報
      const worldTime = this.bot.time.timeOfDay;
      const worldAge = this.bot.time.age;
      const dayTime = this.bot.time.day ? '昼' : '夜';

      // 時刻の計算（24時間制）
      const mcHour = Math.floor(worldTime / 1000);
      const mcMinute = Math.floor((worldTime % 1000) / (1000 / 60));
      const formattedTime = `${mcHour.toString().padStart(2, '0')}:${mcMinute
        .toString()
        .padStart(2, '0')}`;

      // 何日目かの計算
      const dayNumber = Math.floor(worldAge / 24000) + 1;

      // 天気情報
      const isRaining = this.bot.isRaining;
      const rainState = isRaining ? '雨' : '晴れ';

      // 現在地の座標
      const positionStr = `X:${Math.floor(position.x)}, Y:${Math.floor(
        position.y
      )}, Z:${Math.floor(position.z)}`;

      // 現在いるディメンション
      const dimension = this.bot.game.dimension;

      // プレイヤー情報
      const playerList = Object.keys(this.bot.players).map((name) => ({
        name,
        ping: this.bot.players[name].ping,
      }));

      // 結果をJSON形式でまとめる
      const worldInfo = {
        biome: {
          id: biomeId,
          name: biomeName,
        },
        chunk: chunkInfo,
        time: {
          timeOfDay: worldTime,
          formattedTime,
          dayNumber,
          worldAge,
          isDaytime: this.bot.time.day,
          dayTime,
        },
        weather: {
          isRaining,
          rainState,
        },
        position: {
          x: Math.floor(position.x),
          y: Math.floor(position.y),
          z: Math.floor(position.z),
          positionStr,
        },
        dimension,
        players: playerList,
        gameMode: this.bot.game.gameMode,
        difficulty: this.bot.game.difficulty,
        maxPlayers: this.bot.game.maxPlayers,
        serverBrand: this.bot.game.serverBrand,
      };

      return {
        success: true,
        result: JSON.stringify(worldInfo, null, 2),
      };
    } catch (error: any) {
      return {
        success: false,
        result: `ワールド情報の取得中にエラーが発生しました: ${error.message}`,
      };
    }
  }

  // バイオームIDから名前への変換
  getBiomeName(biomeId: number): string {
    try {
      const registry = prismarineRegistry.default(this.bot.version);
      const Biome = prismarineBiome(registry);
      const biome = new Biome(biomeId);
      return biome.name || `Unknown Biome (ID: ${biomeId})`;
    } catch (e) {
      return `Unknown Biome (ID: ${biomeId})`;
    }
  }
}

export default GetWorldInfo;
