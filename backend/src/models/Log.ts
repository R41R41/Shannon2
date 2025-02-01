import { ILog } from '@shannon/common/src/types';
import mongoose from 'mongoose';

const LogSchema = new mongoose.Schema<ILog>({
  timestamp: { type: Date, required: true },
  memoryZone: { type: String, required: true },
  color: { type: String, required: true },
  content: { type: String, required: true },
});

export default mongoose.model<ILog>('Log', LogSchema);
