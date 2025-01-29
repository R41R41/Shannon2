import mongoose from 'mongoose';
import { ILog } from '../types/types.js';

const LogSchema = new mongoose.Schema<ILog>({
  timestamp: { type: Date, required: true },
  memoryZone: { type: String, required: true },
  color: { type: String, required: true },
  content: { type: String, required: true },
});

export default mongoose.model<ILog>('Log', LogSchema);
