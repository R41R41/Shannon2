import mcData from 'minecraft-data';
import prismarineBiome from 'prismarine-biome';
import * as prismarineRegistry from 'prismarine-registry';
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
  }

  async run() {
    if (this.isLocked) return;
    this.isLocked = true;
    try {
      this.bot.selfState.botPosition = this.bot.entity.position;
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
      const dayTime = this.bot.time.day ? '昼' : '夜';
      // 時刻の計算（24時間制）
      const mcHour = Math.floor(worldTime / 1000);
      const mcMinute = Math.floor((worldTime % 1000) / (1000 / 60));
      const formattedTime = `${mcHour.toString().padStart(2, '0')}:${mcMinute
        .toString()
        .padStart(2, '0')}`;
      const position = this.bot.entity.position;
      const biomeId = this.bot.world.getBiome(position);
      const biomeName = this.getBiomeName(biomeId);
      this.bot.environmentState.weather = rainState;
      this.bot.environmentState.time = `${dayTime} ${formattedTime}`;
      this.bot.environmentState.biome = biomeName;
      this.bot.environmentState.dimension = this.bot.game.dimension;
    } catch (e) {
      console.error(`Error updating self state and environment state: ${e}`);
      this.isLocked = false;
    }
    this.isLocked = false;
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
