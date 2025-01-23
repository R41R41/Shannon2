import { makeAutoObservable } from "mobx";

export class AudioQueueManager {
  audioQueue: Int16Array[] = [];
  isPlaying = false;
  pitchFactor = 0.6;

  constructor() {
    makeAutoObservable(this);
  }

  setPitchFactor(factor: number) {
    this.pitchFactor = factor;
  }

  addAudioToQueue(audioData: Int16Array) {
    this.audioQueue.push(audioData);
    this.playNext();
  }

  async playNext() {
    if (this.isPlaying || this.audioQueue.length === 0) return;

    this.isPlaying = true;
    const audioData = this.audioQueue.shift();
    if (audioData) {
      await this.playAudio(audioData);
    }
    this.isPlaying = false;
    this.playNext();
  }

  playAudio(audioBuffer: Int16Array): Promise<void> {
    return new Promise((resolve) => {
      const audioContext = new AudioContext();
      const float32Array = new Float32Array(audioBuffer.length);

      for (let i = 0; i < audioBuffer.length; i++) {
        float32Array[i] = audioBuffer[i] / 0x7fff;
      }

      const audioBufferObj = audioContext.createBuffer(
        1,
        float32Array.length,
        audioContext.sampleRate
      );
      audioBufferObj.copyToChannel(float32Array, 0);

      const source = audioContext.createBufferSource();
      source.buffer = audioBufferObj;
      source.playbackRate.value = this.pitchFactor;
      source.connect(audioContext.destination);

      source.onended = () => {
        resolve();
      };

      source.start(0);
    });
  }
} 