import mongoose from 'mongoose';
import { Color } from '../services/eventBus';
import { Platform } from '../services/llm/types/index.js';

export interface ILog {
  timestamp: Date;
  platform: Platform;
  color: Color;
  content: string;
}

const LogSchema = new mongoose.Schema<ILog>({
  timestamp: { type: Date, required: true },
  platform: { type: String, required: true },
  color: { type: String, required: true },
  content: { type: String, required: true },
});

export default mongoose.model<ILog>('Log', LogSchema);
