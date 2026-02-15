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
  relatedPersonId?: Types.ObjectId;
  createdAt: Date;
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
  relatedPersonId: { type: Schema.Types.ObjectId, ref: 'PersonMemory' },
  createdAt: { type: Date, default: Date.now },
});

// カテゴリ + 重要度 + 日時 で検索・eviction
ShannonMemorySchema.index({ category: 1, importance: -1, createdAt: -1 });

// tags での検索用
ShannonMemorySchema.index({ tags: 1 });

// 全文検索用 (content + tags)
ShannonMemorySchema.index({ content: 'text' }, { default_language: 'none' });

export const ShannonMemory = mongoose.model<IShannonMemory>(
  'ShannonMemory',
  ShannonMemorySchema,
);
