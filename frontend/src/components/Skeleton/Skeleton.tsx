import styles from './Skeleton.module.scss';

interface SkeletonProps {
  width?: string;
  height?: string;
  count?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({ width = '100%', height = '16px', count = 1 }) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className={styles.skeleton}
        style={{ width, height }}
      />
    ))}
  </>
);

export const SkeletonCard: React.FC = () => (
  <div className={styles.card}>
    <Skeleton height="12px" width="40%" />
    <Skeleton height="20px" width="60%" />
    <Skeleton height="10px" width="80%" />
  </div>
);
