import React, { useState, useEffect, useRef } from "react";
import styles from "./Emotion.module.scss";
import { EmotionType } from "@common/types/taskGraph";
import { EmotionAgent } from "@/services/agents/emotionAgent";
import { Radar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  TooltipItem,
} from "chart.js";
import classNames from "classnames";

ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

interface EmotionProps {
  emotion: EmotionAgent | null;
  isMobile?: boolean;
}

const EMOTION_LABELS = [
  "喜び",
  "信頼",
  "恐れ",
  "驚き",
  "悲しみ",
  "嫌悪",
  "怒り",
  "期待",
];

const EMOTION_GROUPS = {
  positive: { r: 74, g: 222, b: 128 },
  negative: { r: 96, g: 165, b: 250 },
  anger: { r: 248, g: 113, b: 113 },
  surprise: { r: 251, g: 191, b: 36 },
};

const Emotion: React.FC<EmotionProps> = ({ emotion, isMobile }) => {
  const [emotionState, setEmotionState] = useState<EmotionType | null>(null);
  const animationRef = useRef<number>();
  const [animatedValues, setAnimatedValues] = useState<number[]>(
    Array(8).fill(50)
  );

  const calculateColor = (values: number[]) => {
    const positive = (values[0] + values[1]) / 200;
    const negative = (values[2] + values[4] + values[5]) / 300;
    const anger = values[6] / 100;
    const surprise = (values[3] + values[7]) / 200;
    const total = positive + negative + anger + surprise || 1;

    const r =
      (EMOTION_GROUPS.positive.r * positive +
        EMOTION_GROUPS.negative.r * negative +
        EMOTION_GROUPS.anger.r * anger +
        EMOTION_GROUPS.surprise.r * surprise) /
      total;
    const g =
      (EMOTION_GROUPS.positive.g * positive +
        EMOTION_GROUPS.negative.g * negative +
        EMOTION_GROUPS.anger.g * anger +
        EMOTION_GROUPS.surprise.g * surprise) /
      total;
    const b =
      (EMOTION_GROUPS.positive.b * positive +
        EMOTION_GROUPS.negative.b * negative +
        EMOTION_GROUPS.anger.b * anger +
        EMOTION_GROUPS.surprise.b * surprise) /
      total;

    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  };

  useEffect(() => {
    if (emotion) {
      emotion.onUpdateEmotion((e) => setEmotionState(e));
    }
  }, [emotion]);

  useEffect(() => {
    let lastUpdate = Date.now();
    const UPDATE_INTERVAL = 1000;

    const animate = () => {
      const now = Date.now();
      if (now - lastUpdate >= UPDATE_INTERVAL) {
        const newValues = Array(8)
          .fill(0)
          .map((_, i) => {
            const baseValue = emotionState
              ? [
                  emotionState.parameters.joy,
                  emotionState.parameters.trust,
                  emotionState.parameters.fear,
                  emotionState.parameters.surprise,
                  emotionState.parameters.sadness,
                  emotionState.parameters.disgust,
                  emotionState.parameters.anger,
                  emotionState.parameters.anticipation,
                ][i]
              : 50;

            const range = baseValue * 0.1;
            const randomOffset = Math.random() * range;
            return Math.max(0, Math.min(100, baseValue + randomOffset));
          });

        setAnimatedValues(newValues);
        lastUpdate = now;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [emotionState]);

  const color = calculateColor(animatedValues);
  const colorStr = `${color.r}, ${color.g}, ${color.b}`;

  const chartData = {
    labels: EMOTION_LABELS,
    datasets: [
      {
        label: "感情パラメータ",
        data: animatedValues,
        backgroundColor: `rgba(${colorStr}, 0.12)`,
        borderColor: `rgba(${colorStr}, 0.8)`,
        borderWidth: 2,
        pointBackgroundColor: `rgba(${colorStr}, 1)`,
        pointBorderColor: "transparent",
        pointRadius: 3,
        pointHoverRadius: 5,
      },
    ],
  };

  const chartOptions = {
    scales: {
      r: {
        min: 0,
        max: 100,
        beginAtZero: true,
        ticks: {
          stepSize: 20,
          backdropColor: "transparent",
          color: "rgba(255, 255, 255, 0.2)",
          display: true,
          showLabelBackdrop: false,
          font: { size: 9 },
        },
        grid: {
          color: "rgba(255, 255, 255, 0.06)",
        },
        angleLines: {
          color: "rgba(255, 255, 255, 0.06)",
        },
        pointLabels: {
          color: "rgba(255, 255, 255, 0.6)",
          font: { size: 11, weight: "500" as const },
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        displayColors: false,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        titleFont: { size: 11 },
        bodyFont: { size: 12 },
        padding: 8,
        cornerRadius: 6,
        callbacks: {
          label: (context: TooltipItem<"radar">) =>
            `${Math.round(context.raw as number)}`,
        },
      },
    },
    animation: {
      duration: 2000,
      easing: "linear" as const,
    },
    maintainAspectRatio: false,
  };

  return (
    <div className={classNames(styles.card, { [styles.mobile]: isMobile })}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>Emotion</span>
        {emotionState?.emotion && (
          <span
            className={styles.emotionBadge}
            style={{
              backgroundColor: `rgba(${colorStr}, 0.15)`,
              color: `rgb(${colorStr})`,
            }}
          >
            {emotionState.emotion}
          </span>
        )}
      </div>

      <div className={styles.chartWrapper}>
        <Radar data={chartData} options={chartOptions} />
      </div>
    </div>
  );
};

export default Emotion;
