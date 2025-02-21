import mongoose from 'mongoose';

interface IUser {
  name: string;
  email: string;
  createdAt: Date;
  isAuthorized: boolean;
  isAdmin: boolean;
}

const userSchema = new mongoose.Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  createdAt: { type: Date, default: Date.now },
  isAuthorized: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
});

// インデックスを確実に作成
userSchema.index({ email: 1 }, { unique: true });

export const User = mongoose.model<IUser>('User', userSchema);
