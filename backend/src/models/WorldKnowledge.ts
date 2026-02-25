/**
 * Minebot ワールド知識の永続化モデル。
 * 発見したブロック・構造物・チェスト・バイオーム・危険地帯を記録し、
 * 地理空間インデックスで高速検索する。
 */
import mongoose, { Schema, Document } from 'mongoose';

// ─── 共通型 ───

interface Position {
  x: number;
  y: number;
  z: number;
}

const PositionSchema = new Schema<Position>(
  { x: Number, y: Number, z: Number },
  { _id: false },
);

// GeoJSON Point for 2dsphere index (xz plane)
interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [x, z]
}

const GeoPointSchema = new Schema<GeoPoint>(
  { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: [Number] },
  { _id: false },
);

// ─── 1. Blocks ───

export interface IWorldBlock extends Document {
  serverName: string;
  blockName: string;
  position: Position;
  geo: GeoPoint;
  discoveredAt: Date;
  lastVerifiedAt: Date;
  quantity: number;
}

const WorldBlockSchema = new Schema<IWorldBlock>({
  serverName: { type: String, required: true, index: true },
  blockName: { type: String, required: true, index: true },
  position: { type: PositionSchema, required: true },
  geo: { type: GeoPointSchema, required: true, index: '2dsphere' },
  discoveredAt: { type: Date, default: Date.now },
  lastVerifiedAt: { type: Date, default: Date.now },
  quantity: { type: Number, default: 1 },
});

WorldBlockSchema.index({ serverName: 1, blockName: 1, 'position.x': 1, 'position.y': 1, 'position.z': 1 }, { unique: true });
WorldBlockSchema.index({ lastVerifiedAt: 1 }, { expireAfterSeconds: 86400 }); // 24h TTL

// ─── 2. Structures ───

export interface IWorldStructure extends Document {
  serverName: string;
  structureType: string;
  position: Position;
  geo: GeoPoint;
  discoveredAt: Date;
  characteristicBlocks: string[];
}

const WorldStructureSchema = new Schema<IWorldStructure>({
  serverName: { type: String, required: true, index: true },
  structureType: { type: String, required: true, index: true },
  position: { type: PositionSchema, required: true },
  geo: { type: GeoPointSchema, required: true, index: '2dsphere' },
  discoveredAt: { type: Date, default: Date.now },
  characteristicBlocks: [String],
});

WorldStructureSchema.index({ serverName: 1, structureType: 1 });

// ─── 3. Containers ───

export interface IWorldContainer extends Document {
  serverName: string;
  containerType: string;
  position: Position;
  geo: GeoPoint;
  contents: Array<{ name: string; count: number }>;
  lastCheckedAt: Date;
  accessCount: number;
}

const WorldContainerSchema = new Schema<IWorldContainer>({
  serverName: { type: String, required: true, index: true },
  containerType: { type: String, required: true },
  position: { type: PositionSchema, required: true },
  geo: { type: GeoPointSchema, required: true, index: '2dsphere' },
  contents: [{ name: String, count: Number, _id: false }],
  lastCheckedAt: { type: Date, default: Date.now },
  accessCount: { type: Number, default: 1 },
});

WorldContainerSchema.index(
  { serverName: 1, 'position.x': 1, 'position.y': 1, 'position.z': 1 },
  { unique: true },
);

// ─── 4. Zones (biomes / explored areas) ───

export interface IWorldZone extends Document {
  serverName: string;
  biome: string;
  position: Position;
  geo: GeoPoint;
  discoveredAt: Date;
}

const WorldZoneSchema = new Schema<IWorldZone>({
  serverName: { type: String, required: true, index: true },
  biome: { type: String, required: true, index: true },
  position: { type: PositionSchema, required: true },
  geo: { type: GeoPointSchema, required: true, index: '2dsphere' },
  discoveredAt: { type: Date, default: Date.now },
});

// ─── 5. Dangers ───

export interface IWorldDanger extends Document {
  serverName: string;
  dangerType: string;
  position: Position;
  geo: GeoPoint;
  severity: number;
  discoveredAt: Date;
  lastSeenAt: Date;
  description: string;
}

const WorldDangerSchema = new Schema<IWorldDanger>({
  serverName: { type: String, required: true, index: true },
  dangerType: { type: String, required: true },
  position: { type: PositionSchema, required: true },
  geo: { type: GeoPointSchema, required: true, index: '2dsphere' },
  severity: { type: Number, default: 5 },
  discoveredAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  description: { type: String, default: '' },
});

WorldDangerSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 3600 }); // 1h TTL

// ─── 6. Bot Snapshots ───

export interface IBotSnapshot extends Document {
  serverName: string;
  timestamp: Date;
  position: Position;
  health: number;
  food: number;
  dimension: string;
  biome: string;
  inventory: Array<{ name: string; count: number }>;
}

const BotSnapshotSchema = new Schema<IBotSnapshot>({
  serverName: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  position: { type: PositionSchema, required: true },
  health: Number,
  food: Number,
  dimension: String,
  biome: String,
  inventory: [{ name: String, count: Number, _id: false }],
});

BotSnapshotSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 }); // 7 days TTL

// ─── Model Exports ───

function getModel<T>(name: string, schema: Schema): mongoose.Model<T> {
  try { return mongoose.model<T>(name); }
  catch { return mongoose.model<T>(name, schema); }
}

export const WorldBlock = getModel<IWorldBlock>('WorldBlock', WorldBlockSchema);
export const WorldStructure = getModel<IWorldStructure>('WorldStructure', WorldStructureSchema);
export const WorldContainer = getModel<IWorldContainer>('WorldContainer', WorldContainerSchema);
export const WorldZone = getModel<IWorldZone>('WorldZone', WorldZoneSchema);
export const WorldDanger = getModel<IWorldDanger>('WorldDanger', WorldDangerSchema);
export const BotSnapshot = getModel<IBotSnapshot>('BotSnapshot', BotSnapshotSchema);
