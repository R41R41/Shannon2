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

const Emotion: React.FC<EmotionProps> = ({ emotion, isMobile }) => {
  const [emotionState, setEmotionState] = useState<EmotionType | null>(null);
  const animationRef = useRef<number>();
  const [animatedValues, setAnimatedValues] = useState<number[]>(
    Array(8).fill(50)
  );

  // 感情グループごとの色を定義
  const emotionColors = {
    positive: { r: 0, g: 255, b: 0 }, // 黄色 (喜び・期待・信頼)
    negative: { r: 0, g: 0, b: 255 }, // 青 (恐れ・悲しみ・嫌悪)
    anger: { r: 255, g: 0, b: 0 }, // 赤 (怒り)
    surprise: { r: 255, g: 255, b: 255 }, // 白 (驚き)
  };

  // 感情値から色を計算
  const calculateColor = (values: number[]) => {
    const positive = (values[0] + values[1]) / 200; // joy, trust, anticipation
    const negative = (values[2] + values[4] + values[5]) / 300; // fear, sadness, disgust
    const anger = values[6] / 100; // anger
    const surprise = (values[3] + values[7]) / 200; // surprise

    // 各色の重みを計算
    const r =
      (emotionColors.positive.r * positive +
        emotionColors.negative.r * negative +
        emotionColors.anger.r * anger +
        emotionColors.surprise.r * surprise) /
      (positive + negative + anger + surprise || 1);

    const g =
      (emotionColors.positive.g * positive +
        emotionColors.negative.g * negative +
        emotionColors.anger.g * anger +
        emotionColors.surprise.g * surprise) /
      (positive + negative + anger + surprise || 1);

    const b =
      (emotionColors.positive.b * positive +
        emotionColors.negative.b * negative +
        emotionColors.anger.b * anger +
        emotionColors.surprise.b * surprise) /
      (positive + negative + anger + surprise || 1);

    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
  };

  useEffect(() => {
    if (emotion) {
      emotion.onUpdateEmotion((emotion) => {
        setEmotionState(emotion);
      });
    }
  }, [emotion]);

  // アイドル時のアニメーション
  useEffect(() => {
    let lastUpdate = Date.now();
    const UPDATE_INTERVAL = 1000; // 1秒ごとに更新

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
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [emotionState]);

  const chartData = {
    labels: ["喜び", "信頼", "恐れ", "驚き", "悲しみ", "嫌悪", "怒り", "期待"],
    datasets: [
      {
        label: "感情パラメータ",
        data: animatedValues,
        backgroundColor: `${calculateColor(animatedValues)}, 0.2)`,
        borderColor: `${calculateColor(animatedValues)}, 1)`,
        borderWidth: 2,
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
          color: "rgba(255, 255, 255, 0.7)",
          display: true,
          showLabelBackdrop: false,
        },
        grid: {
          color: "rgba(255, 255, 255, 0.1)",
          display: true,
        },
        angleLines: {
          color: "rgba(255, 255, 255, 0.1)",
        },
        pointLabels: {
          color: "rgba(255, 255, 255, 0.8)",
          font: {
            size: 12,
          },
        },
      },
    },
    plugins: {
      tooltip: {
        enabled: true,
        displayColors: false,
        callbacks: {
          label: (context: TooltipItem<"radar">) =>
            `${Math.round(context.raw as number)}`,
        },
      },
      datalabels: {
        color: "rgba(255, 255, 255, 0.8)",
        anchor: "end",
        align: "end",
        offset: 5,
        formatter: (value: number) => Math.round(value),
      },
    },
    animation: {
      duration: 2000,
      easing: "linear" as const,
    },
    maintainAspectRatio: false,
  };

  return (
    <div className={`${styles.emotion} ${isMobile ? styles.mobile : ""}`}>
      <div className={styles.emotionName}>
        <span>感情: </span>
        <span>{emotionState?.emotion ?? "-"}</span>
      </div>
      <div className={styles.chart}>
        <Radar data={chartData} options={chartOptions} />
      </div>
    </div>
  );
};

export default Emotion;
