import { useEffect, useState, useCallback } from 'react';
import styles from './Toast.module.scss';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  level: ToastLevel;
  duration?: number;
}

let toastId = 0;
let addToastFn: ((toast: Omit<ToastItem, 'id'>) => void) | null = null;

export function showToast(message: string, level: ToastLevel = 'info', duration = 4000) {
  addToastFn?.({ message, level, duration });
}

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, toast.duration || 4000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.level]}`}>
          <span className={styles.icon}>
            {t.level === 'success' ? '✓' : t.level === 'error' ? '✕' : t.level === 'warning' ? '⚠' : 'ℹ'}
          </span>
          <span className={styles.message}>{t.message}</span>
        </div>
      ))}
    </div>
  );
};
