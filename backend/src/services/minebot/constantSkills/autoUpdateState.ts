import mcData from 'minecraft-data';
import prismarineBiome from 'prismarine-biome';
import * as prismarineRegistry from 'prismarine-registry';
import { Vec3 } from 'vec3';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoUpdateState extends ConstantSkill {
  private mcData: any;
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'auto-update-state';
    this.description = 'selfStateとenvironmentStateを更新します';
    this.interval = null;
    this.status = false;
    this.mcData = mcData(this.bot.version);
    this.priority = 10;
  }

  async runImpl() {
    try {
      const position = this.bot.entity.position;
      this.bot.selfState.botPosition = new Vec3(
        Number(position.x.toFixed(1)),
        Number(position.y.toFixed(1)),
        Number(position.z.toFixed(1))
      );
      this.bot.selfState.botHealth = `${this.bot.health}/20`;
      this.bot.selfState.botFoodLevel = `${this.bot.food}/20`;
      this.bot.selfState.botHeldItem = this.bot.heldItem
        ? this.bot.heldItem.name
        : 'なし';
      this.bot.selfState.inventory = this.bot.inventory.items().map((item) => ({
        name: item.name,
        count: item.count,
      }));
      const isRaining = this.bot.isRaining;
      const rainState = isRaining ? '雨' : '晴れ';
      const worldTime = this.bot.time.timeOfDay;
      // 時刻の計算（24時間制）
      // Minecraft: worldTime=0 → 6:00, worldTime=6000 → 12:00, worldTime=12000 → 18:00
      const mcHour = (Math.floor(worldTime / 1000) + 6) % 24;
      // 昼夜判定: 6:00-18:00（worldTime 0-12000）が昼、それ以外が夜
      const dayTime = worldTime < 12000 ? '昼' : '夜';
      const mcMinute = Math.floor((worldTime % 1000) / (1000 / 60));
      const formattedTime = `${mcHour.toString().padStart(2, '0')}:${mcMinute
        .toString()
        .padStart(2, '0')}`;
      const biomeId = this.bot.world.getBiome(position);
      const biomeName = this.getBiomeName(biomeId);
      this.bot.environmentState.weather = rainState;
      this.bot.environmentState.time = `${dayTime} ${formattedTime}`;
      this.bot.environmentState.biome = biomeName;
      this.bot.environmentState.dimension = this.bot.game.dimension;
    } catch (e) {
      console.error(`Error updating self state and environment state: ${e}`);
    }
  }

  private getBiomeName(biomeId: number): string {
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

export default AutoUpdateState;
