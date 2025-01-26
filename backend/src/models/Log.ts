import mongoose from 'mongoose';
import { Color } from '../services/eventBus';
import { Platform } from '../services/llm/types/index.js';

export interface ILog {
  timestamp: string;
  platform: Platform;
  color: Color;
  content: string;
}

const LogSchema = new mongoose.Schema<ILog>({
  timestamp: { type: String, required: true },
  platform: { type: String, required: true },
  color: { type: String, required: true },
  content: { type: String, required: true },
});

export default mongoose.model<ILog>('Log', LogSchema);
