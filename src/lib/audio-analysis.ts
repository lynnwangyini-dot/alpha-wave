/**
 * 音频特征分析库
 * 全部在浏览器端运行（Web Audio API + Canvas offline 分析）
 * 包含：BPM、调性、情绪、能量曲线
 */

export interface AudioAnalysis {
  /** 估计的节拍速度（BPM） */
  bpm: number;
  /** 调性主音（"C", "C#", ..., "B"） */
  keyRoot: string;
  /** 大调或小调 */
  keyMode: 'major' | 'minor';
  /** 完整调性字符串，例如 "A minor" */
  key: string;
  /** 情绪标签 */
  mood: string;
  /** 0-1 能量（响度） */
  energy: number;
  /** 0-1 亮度（频谱质心归一化） */
  brightness: number;
  /** 0-1 节律强度 */
  rhythmicity: number;
  /** 0-1 温暖度（低频能量占比） */
  warmth: number;
  /** 32 个时窗的 RMS 能量曲线（0-1） */
  energyCurve: number[];
  /** 时长（秒） */
  duration: number;
  /** 采样率 */
  sampleRate: number;
}

// Krumhansl-Schmuckler key profiles (大调 / 小调)
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const KEY_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

/**
 * 解码音频文件为 AudioBuffer
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    return buffer;
  } finally {
    // 释放临时 context
    ctx.close().catch(() => {});
  }
}

/**
 * 提取单声道 PCM 数据（取左右平均）
 */
function getMonoPCM(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  if (channels === 1) {
    return buffer.getChannelData(0);
  }
  const out = new Float32Array(length);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let i = 0; i < length; i++) {
    out[i] = (left[i] + right[i]) * 0.5;
  }
  return out;
}

/**
 * 估计 BPM —— 自相关法
 */
function estimateBPM(buffer: AudioBuffer, pcm: Float32Array): number {
  const sampleRate = buffer.sampleRate;
  // 用 60-180 BPM 区间（搜索 lag = 60 / BPM * sr）
  const minBPM = 60;
  const maxBPM = 180;
  const minLag = Math.floor((60 / maxBPM) * sampleRate);
  const maxLag = Math.floor((60 / minBPM) * sampleRate);

  // 1) 提取 onset envelope（短时能量差分 + 半波整流）
  const frameSize = 1024;
  const hop = 512;
  const numFrames = Math.floor((pcm.length - frameSize) / hop);
  const energy: number[] = new Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < frameSize; i++) {
      const s = pcm[start + i];
      sum += s * s;
    }
    energy[f] = sum;
  }
  // 差分
  const onset: number[] = new Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  }

  // 2) 自相关寻找周期
  // onset 已经做了帧降采样，按 512/sr 计算时间
  const onsetRate = sampleRate / hop;
  let bestLag = minLag;
  let bestVal = -Infinity;
  // 转成帧单位的 lag
  const minLagFrames = Math.max(2, Math.floor(minLag / hop));
  const maxLagFrames = Math.floor(maxLag / hop);
  for (let lag = minLagFrames; lag <= maxLagFrames; lag++) {
    let acc = 0;
    const N = numFrames - lag;
    for (let f = 0; f < N; f++) {
      acc += onset[f] * onset[f + lag];
    }
    if (acc > bestVal) {
      bestVal = acc;
      bestLag = lag;
    }
  }
  // 帧 lag 转 BPM
  let bpm = (60 * onsetRate) / bestLag;
  // 折叠到 60-180 区间
  while (bpm < minBPM) bpm *= 2;
  while (bpm > maxBPM) bpm /= 2;
  return Math.round(bpm);
}

/**
 * 估计调性 —— Chromagram + Krumhansl-Schmuckler 模板
 */
function estimateKey(
  buffer: AudioBuffer,
  pcm: Float32Array,
): { keyRoot: string; keyMode: 'major' | 'minor' } {
  const sampleRate = buffer.sampleRate;
  const chroma = new Array(12).fill(0);

  // 简单 DFT（够用了：每帧 O(n log n) 还是太慢，我们只关心 12 个 bin，做简化累加）
  // 这里用一个更轻量的策略：用 Goertzel 风格按 octave band 累加到 12 个 pitch class
  // 12 个音名对应频率：A4=440, A#4, ..., G#4
  // 计算 C2..C7 范围的能量分布
  const A4 = 440;
  const semitoneRatio = Math.pow(2, 1 / 12);
  for (let midi = 36; midi <= 96; midi++) {
    const f = A4 * Math.pow(semitoneRatio, midi - 69);
    if (f >= sampleRate / 2) break;
    const pc = midi % 12; // C=0
    // 计算该频率附近的能量
    // 用简化方式：滑动窗口短时能量调制
    // 实际更稳妥：DFT 在该 bin —— 但 4096 点 DFT 在每帧都做太慢
    // 折中：每帧只对当前帧做一次 FFT（Cooley-Tukey 迭代实现）
    // ---- 简化：直接累加该频率处的短时能量相关性 ----
    // 相关性：sum(pcm[t] * cos(2π f t/sr))
    const period = sampleRate / f;
    let acc = 0;
    const len = Math.min(pcm.length, Math.floor(period * 16));
    for (let t = 0; t < len; t++) {
      acc += pcm[t] * Math.cos((2 * Math.PI * t) / period);
    }
    chroma[pc] += Math.abs(acc) / len;
  }
  // 归一化
  const sum = chroma.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 12; i++) chroma[i] /= sum;

  // 与 24 个调式模板（12 大调 + 12 小调）做 Pearson 相关
  let bestScore = -Infinity;
  let bestIdx = 0;
  let bestMode: 'major' | 'minor' = 'major';
  const normChroma = normalize(chroma);
  for (let i = 0; i < 12; i++) {
    // 大调：从 i 开始旋转 MAJOR_PROFILE
    const major = rotate(MAJOR_PROFILE, i);
    const minor = rotate(MINOR_PROFILE, i);
    const sM = pearson(normChroma, normalize(major));
    const sm = pearson(normChroma, normalize(minor));
    if (sM > bestScore) {
      bestScore = sM;
      bestIdx = i;
      bestMode = 'major';
    }
    if (sm > bestScore) {
      bestScore = sm;
      bestIdx = i;
      bestMode = 'minor';
    }
  }
  // 静默 unused
  return { keyRoot: KEY_NAMES[bestIdx], keyMode: bestMode };
}

function rotate<T>(arr: T[], offset: number): T[] {
  const n = arr.length;
  return arr.map((_, i) => arr[(i - offset + n) % n]);
}
function normalize(arr: number[]): number[] {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std =
    Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length) || 1;
  return arr.map((v) => (v - mean) / std);
}
function pearson(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * 计算能量曲线（32 帧 RMS）
 */
function computeEnergyCurve(pcm: Float32Array, frames = 32): number[] {
  const frameSize = Math.floor(pcm.length / frames);
  const out: number[] = [];
  let max = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * frameSize;
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = pcm[start + i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / frameSize);
    out.push(rms);
    if (rms > max) max = rms;
  }
  return out.map((v) => (max > 0 ? v / max : 0));
}

/**
 * 估计情绪标签
 */
function inferMood(
  energy: number,
  brightness: number,
  warmth: number,
  rhythmicity: number,
): string {
  // 简单规则
  if (energy > 0.6 && warmth < 0.45 && rhythmicity > 0.4) return 'Energetic · 激烈';
  if (warmth > 0.55 && brightness < 0.45) return 'Warm · 沉静';
  if (brightness > 0.6 && energy < 0.4) return 'Bright · 空灵';
  if (energy < 0.3 && warmth > 0.45) return 'Calm · 冥想';
  if (rhythmicity > 0.55) return 'Driving · 律动';
  if (warmth < 0.35 && brightness > 0.55) return 'Crisp · 锋利';
  if (energy < 0.4) return 'Mellow · 柔软';
  return 'Balanced · 平衡';
}

/**
 * 计算频谱质心（亮度）
 */
function computeBrightness(pcm: Float32Array, sampleRate: number): number {
  // 简化：用 Goertzel 风格对若干频率点加权
  const freqs = [200, 400, 800, 1600, 3200, 6400];
  const weights: number[] = [];
  for (const f of freqs) {
    const period = sampleRate / f;
    let acc = 0;
    const len = Math.min(pcm.length, Math.floor(period * 16));
    for (let t = 0; t < len; t++) {
      acc += Math.abs(pcm[t] * Math.cos((2 * Math.PI * t) / period));
    }
    weights.push(acc / len);
  }
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let weightedSum = 0;
  for (let i = 0; i < freqs.length; i++) {
    weightedSum += (weights[i] / total) * freqs[i];
  }
  // 归一化到 0-1（8000Hz 上限）
  return Math.min(1, weightedSum / 4000);
}

/**
 * 计算温暖度（低频能量占比）
 */
function computeWarmth(pcm: Float32Array, sampleRate: number): number {
  const lowPeriod = sampleRate / 300; // 300Hz
  const highPeriod = sampleRate / 3000;
  let lowE = 0;
  let highE = 0;
  const len = Math.min(pcm.length, 4096);
  for (let t = 0; t < len; t++) {
    lowE += Math.abs(pcm[t] * Math.cos((2 * Math.PI * t) / lowPeriod));
    highE += Math.abs(pcm[t] * Math.cos((2 * Math.PI * t) / highPeriod));
  }
  const total = lowE + highE || 1;
  return lowE / total;
}

/**
 * 计算节律强度（onset envelope 的方差）
 */
function computeRhythmicity(pcm: Float32Array): number {
  const frameSize = 1024;
  const hop = 512;
  const numFrames = Math.floor((pcm.length - frameSize) / hop);
  const energy: number[] = new Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < frameSize; i++) {
      const s = pcm[start + i];
      sum += s * s;
    }
    energy[f] = sum;
  }
  let mean = 0;
  for (const e of energy) mean += e;
  mean /= energy.length || 1;
  let variance = 0;
  for (const e of energy) variance += (e - mean) ** 2;
  variance /= energy.length || 1;
  // 归一化到 0-1（经验值 0.0001 视为 1.0）
  return Math.min(1, Math.sqrt(variance) / (mean + 1e-6) / 2);
}

/**
 * 完整分析入口
 */
export function analyzeAudio(buffer: AudioBuffer): AudioAnalysis {
  const pcm = getMonoPCM(buffer);
  const duration = buffer.duration;
  const sampleRate = buffer.sampleRate;

  const bpm = estimateBPM(buffer, pcm);
  const { keyRoot, keyMode } = estimateKey(buffer, pcm);
  const energyCurve = computeEnergyCurve(pcm, 32);
  // 全局能量
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
  const energy = Math.min(1, Math.sqrt(sumSq / pcm.length) * 4);
  const brightness = computeBrightness(pcm, sampleRate);
  const warmth = computeWarmth(pcm, sampleRate);
  const rhythmicity = computeRhythmicity(pcm);
  const mood = inferMood(energy, brightness, warmth, rhythmicity);

  return {
    bpm,
    keyRoot,
    keyMode,
    key: `${keyRoot} ${keyMode === 'major' ? 'Major' : 'Minor'}`,
    mood,
    energy,
    brightness,
    rhythmicity,
    warmth,
    energyCurve,
    duration,
    sampleRate,
  };
}
