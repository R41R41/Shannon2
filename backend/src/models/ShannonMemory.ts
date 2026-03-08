import mongoose, { Schema, Types } from 'mongoose';

export type MemoryCategory = 'experience' | 'knowledge';

export interface IShannonMemory {
  _id: Types.ObjectId;
  category: MemoryCategory;
  content: string;
  feeling?: string;
  context?: string;
  source: string;
  importance: number;
  tags: string[];
  embedding?: number[];
  relatedPersonId?: Types.ObjectId;
  createdAt: Date;

  // Scoped memory fields (Phase 1 migration)
  visibilityScope?: 'private_user' | 'shared_project' | 'shared_channel' | 'shared_world' | 'global_generalized' | 'self_model';
  ownerUserId?: string;
  worldTags?: string[];
  projectTags?: string[];
  channelTags?: string[];
  relationTags?: string[];
  sensitivityLevel?: 'low' | 'mid' | 'high';
  generalized?: boolean;
}

const ShannonMemorySchema = new Schema<IShannonMemory>({
  category: {
    type: String,
    enum: ['experience', 'knowledge'],
    required: true,
  },
  content: { type: String, required: true },
  feeling: { type: String },
  context: { type: String },
  source: { type: String, required: true },
  importance: { type: Number, required: true, min: 1, max: 10 },
  tags: { type: [String], default: [] },
  embedding: { type: [Number], select: false },
  relatedPersonId: { type: Schema.Types.ObjectId, ref: 'PersonMemory' },
  createdAt: { type: Date, default: Date.now },

  // Scoped memory fields (Phase 1 migration)
  visibilityScope: {
    type: String,
    enum: ['private_user', 'shared_project', 'shared_channel', 'shared_world', 'global_generalized', 'self_model'],
    default: 'shared_channel',
  },
  ownerUserId: { type: String },
  worldTags: { type: [String], default: [] },
  projectTags: { type: [String], default: [] },
  channelTags: { type: [String], default: [] },
  relationTags: { type: [String], default: [] },
  sensitivityLevel: {
    type: String,
    enum: ['low', 'mid', 'high'],
    default: 'low',
  },
  generalized: { type: Boolean, default: false },
});

// カテゴリ + 重要度 + 日時 で検索・eviction
ShannonMemorySchema.index({ category: 1, importance: -1, createdAt: -1 });

// tags での検索用
ShannonMemorySchema.index({ tags: 1 });

// 全文検索用 (content + tags)
ShannonMemorySchema.index({ content: 'text' }, { default_language: 'none' });

// スコープ付きメモリ検索用 (visibilityScope + category + importance)
ShannonMemorySchema.index({ visibilityScope: 1, category: 1, importance: -1 });

export const ShannonMemory = mongoose.model<IShannonMemory>(
  'ShannonMemory',
  ShannonMemorySchema,
);
