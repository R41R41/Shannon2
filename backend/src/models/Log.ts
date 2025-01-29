import mongoose from 'mongoose';
import { Color } from '../services/eventBus';
import { MemoryZone } from '../types/index.js';

export interface ILog {
  timestamp: Date;
  memoryZone: MemoryZone;
  color: Color;
  content: string;
}

const LogSchema = new mongoose.Schema<ILog>({
  timestamp: { type: Date, required: true },
  memoryZone: { type: String, required: true },
  color: { type: String, required: true },
  content: { type: String, required: true },
});

export default mongoose.model<ILog>('Log', LogSchema);
