/**
 * 程序化 Ambient 音乐合成 + Alpha 双耳节拍
 * 完全使用 Web Audio API 在客户端动态生成，**不引用任何原曲音频**
 * 输出：可播放的 AudioBuffer（包含双耳节拍）
 */

import type { AudioAnalysis } from './audio-analysis';

/* ====== 音乐理论数据 ====== */

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'C#': 1,
  D: 2,
  'D#': 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  'G#': 8,
  A: 9,
  'A#': 10,
  B: 11,
};

// 12 个调式的常用和弦进行 (罗马数字 -> 在大调中的半音偏移)
// 兼容大小调：根据 mode 选择不同的"主音参照"
const MAJOR_PROGRESSIONS: number[][] = [
  [0, 5, 7, 0], // I-vi-ii-V
  [0, 7, 9, 5], // I-IV-V-vi
  [0, 9, 5, 7], // I-vi-IV-V
  [11, 5, 7, 0], // bVII-IV-V-I
];
const MINOR_PROGRESSIONS: number[][] = [
  [0, 8, 3, 7], // i-VI-iii-VII
  [0, 3, 7, 8], // i-iv-VII-VI
  [7, 0, 3, 8], // VII-i-iv-VI
  [5, 0, 7, 3], // bVI-i-VII-iv
];

// 每个调式内的和弦类型（半音组成）
const TRIAD_QUALITIES: Record<number, [number, number, number, number]> = {
  // [root offset, third, fifth, seventh]
  0: [0, 4, 7, 11], // maj7
  1: [0, 3, 7, 10], // m7
  2: [0, 3, 7, 10], // m7
  3: [0, 4, 7, 11], // maj7
  4: [0, 3, 7, 10], // m7
  5: [0, 4, 7, 11], // maj7
  6: [0, 3, 6, 10], // m7b5
  7: [0, 4, 7, 10], // dom7
  8: [0, 3, 7, 10], // m7
  9: [0, 3, 7, 10], // m7
  10: [0, 3, 6, 10], // m7b5
  11: [0, 4, 7, 10], // dom7 (in major) / maj7 (in minor)
};

const SCALE_PATTERNS: Record<'major' | 'minor', number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/* ====== 工具函数 ====== */

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff);
  };
}

export interface SynthOptions {
  /** 目标时长（秒） */
  duration: number;
  /** 采样率（默认 44100） */
  sampleRate: number;
  /** Alpha 双耳节拍频率（Hz，8-12） */
  alphaHz: number;
  /** 音量（0-1） */
  volume?: number;
  /** 随机种子（基于原曲特征 hash），保证可复现 */
  seed?: number;
  /** 调性主音 */
  keyRoot: string;
  /** 大小调 */
  keyMode: 'major' | 'minor';
  /** 能量映射（控制乐器密度） */
  energy: number;
  /** 温暖度（控制滤波器截止） */
  warmth: number;
  /** 明亮度（控制高频分量） */
  brightness: number;
}

interface ChordNote {
  midi: number;
  start: number;
  end: number;
  velocity: number;
}

/**
 * 根据特征生成一段和弦进行
 */
function buildChordSequence(opts: SynthOptions): ChordNote[][] {
  const rootSemitone = NOTE_TO_SEMITONE[opts.keyRoot] ?? 0;
  const scale = SCALE_PATTERNS[opts.keyMode];
  // 基准八度：中央 C 附近
  const baseOctave = 4;
  const baseMidi = baseOctave * 12 + 12 + rootSemitone;

  // 选一个调式
  const progressions =
    opts.keyMode === 'major' ? MAJOR_PROGRESSIONS : MINOR_PROGRESSIONS;
  const progression = progressions[opts.seed ? opts.seed % progressions.length : 0];

  // 4 个和弦为一组，循环铺满 duration
  const beatSec = 60 / 90; // ambient 默认 90 BPM（舒缓）
  const chordDur = beatSec * 8; // 8 拍一个和弦
  const numChords = Math.ceil(opts.duration / chordDur);

  const chords: ChordNote[][] = [];
  for (let i = 0; i < numChords; i++) {
    const deg = progression[i % progression.length];
    const quality = TRIAD_QUALITIES[deg];
    // deg 在调式中的位置（用 idx 找到调式音）
    const scaleIdx = deg % scale.length;
    const chordRoot = baseMidi + scale[scaleIdx];
    const notes: ChordNote[] = quality.map((offset, j) => ({
      midi: chordRoot + offset,
      start: i * chordDur,
      end: (i + 1) * chordDur + 0.5, // overlap
      velocity: 0.18 + j * 0.04,
    }));
    // 加一个低音根音
    notes.unshift({
      midi: chordRoot - 12,
      start: i * chordDur,
      end: (i + 1) * chordDur + 0.5,
      velocity: 0.35,
    });
    chords.push(notes);
  }
  return chords;
}

/* ====== 合成器节点 ====== */

class PadVoice {
  ctx: OfflineAudioContext;
  output: GainNode;
  constructor(ctx: OfflineAudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
  }
  /** 播放一个持续音（多振荡器叠加 + 低通滤波 + LFO） */
  play(
    freq: number,
    start: number,
    end: number,
    velocity: number,
    filterCutoff: number,
    detune = 0.001,
  ) {
    const dur = end - start;
    // 三个略微失谐的振荡器
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const osc3 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc3.type = 'sine';
    osc1.frequency.value = freq * (1 - detune);
    osc2.frequency.value = freq * (1 + detune);
    osc3.frequency.value = freq * 0.5; // 八度低
    // 振幅包络
    const gain = this.ctx.createGain();
    const a = Math.min(0.8, dur * 0.25);
    const r = Math.min(1.5, dur * 0.4);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(velocity, start + a);
    gain.gain.setValueAtTime(velocity, end - r);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    // 低通滤波（动态）
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterCutoff * 0.7, start);
    filter.frequency.linearRampToValueAtTime(
      filterCutoff,
      start + dur * 0.5,
    );
    filter.frequency.linearRampToValueAtTime(
      filterCutoff * 0.6,
      end,
    );
    filter.Q.value = 0.6;
    // LFO 调制滤波
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.12 + Math.random() * 0.08;
    lfoGain.gain.value = filterCutoff * 0.06;
    lfo.connect(lfoGain).connect(filter.frequency);
    // 输出
    osc1.connect(gain);
    osc2.connect(gain);
    osc3.connect(gain);
    gain.connect(filter).connect(this.output);
    osc1.start(start);
    osc2.start(start);
    osc3.start(start);
    lfo.start(start);
    osc1.stop(end + 0.05);
    osc2.stop(end + 0.05);
    osc3.stop(end + 0.05);
    lfo.stop(end + 0.05);
  }
}

class BellVoice {
  ctx: OfflineAudioContext;
  output: GainNode;
  constructor(ctx: OfflineAudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
  }
  play(freq: number, start: number, velocity = 0.15) {
    const dur = 2.5 + Math.random() * 2;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * 2; // 高八度
    const harm = this.ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.value = freq * 3;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(velocity, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    const harmGain = this.ctx.createGain();
    harmGain.gain.setValueAtTime(0, start);
    harmGain.gain.linearRampToValueAtTime(velocity * 0.4, start + 0.01);
    harmGain.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.5);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq * 2;
    filter.Q.value = 8;
    osc.connect(gain).connect(filter).connect(this.output);
    harm.connect(harmGain).connect(filter);
    osc.start(start);
    harm.start(start);
    osc.stop(start + dur + 0.05);
    harm.stop(start + dur + 0.05);
  }
}

class TextureVoice {
  ctx: OfflineAudioContext;
  output: GainNode;
  buffer: AudioBuffer;
  constructor(ctx: OfflineAudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.5;
    // 生成 4 秒白噪声 buffer（用循环播放实现纹理）
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.buffer = buf;
  }
  play(start: number, end: number, cutoff: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 4;
    const gain = this.ctx.createGain();
    const dur = end - start;
    const a = Math.min(1.5, dur * 0.3);
    const r = Math.min(2, dur * 0.4);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.06, start + a);
    gain.gain.setValueAtTime(0.06, end - r);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(filter).connect(gain).connect(this.output);
    src.start(start);
    src.stop(end + 0.05);
  }
}

class BinauralBeat {
  ctx: OfflineAudioContext;
  output: GainNode;
  alphaHz: number;
  constructor(ctx: OfflineAudioContext, alphaHz: number) {
    this.ctx = ctx;
    this.alphaHz = alphaHz;
    // 用 ChannelMerger 分离左右声道
    this.output = ctx.createGain();
    this.output.gain.value = 1;
  }
  play(start: number, end: number, volume: number) {
    const baseFreq = 200; // 载波基频
    const leftOsc = this.ctx.createOscillator();
    const rightOsc = this.ctx.createOscillator();
    leftOsc.type = 'sine';
    rightOsc.type = 'sine';
    leftOsc.frequency.value = baseFreq;
    rightOsc.frequency.value = baseFreq + this.alphaHz;

    // 左右增益
    const leftGain = this.ctx.createGain();
    const rightGain = this.ctx.createGain();
    const a = 0.6;
    const r = 1.0;
    const fadeStart = Math.max(0, start - a);
    const fadeEnd = end + r;
    leftGain.gain.setValueAtTime(0, fadeStart);
    leftGain.gain.linearRampToValueAtTime(volume, start);
    leftGain.gain.setValueAtTime(volume, end);
    leftGain.gain.linearRampToValueAtTime(0, fadeEnd);
    rightGain.gain.setValueAtTime(0, fadeStart);
    rightGain.gain.linearRampToValueAtTime(volume, start);
    rightGain.gain.setValueAtTime(volume, end);
    rightGain.gain.linearRampToValueAtTime(0, fadeEnd);

    // 合并器
    const merger = this.ctx.createChannelMerger(2);
    leftOsc.connect(leftGain).connect(merger, 0, 0);
    rightOsc.connect(rightGain).connect(merger, 0, 1);
    merger.connect(this.output);

    leftOsc.start(fadeStart);
    rightOsc.start(fadeStart);
    leftOsc.stop(fadeEnd + 0.05);
    rightOsc.stop(fadeEnd + 0.05);
  }
}

/**
 * 简易"混响"模拟：连续延迟网络
 */
function buildReverbChain(
  ctx: OfflineAudioContext,
  input: AudioNode,
  output: AudioNode,
  mix = 0.25,
) {
  const wet = ctx.createGain();
  wet.gain.value = mix;
  const dry = ctx.createGain();
  dry.gain.value = 1 - mix;
  // 三组延迟
  const delays = [0.089, 0.137, 0.233];
  const feedbacks = [0.5, 0.45, 0.4];
  delays.forEach((d, i) => {
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = d;
    const fb = ctx.createGain();
    fb.gain.value = feedbacks[i];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3500 - i * 800;
    input.connect(delay);
    delay.connect(lp);
    lp.connect(fb);
    fb.connect(delay);
    lp.connect(wet);
  });
  input.connect(dry);
  wet.connect(output);
  dry.connect(output);
}

/* ====== 主入口 ====== */

export interface SynthResult {
  buffer: AudioBuffer;
  duration: number;
  bpm: number;
  chordCount: number;
}

export function generateAlphaMusic(
  analysis: AudioAnalysis,
  overrides?: Partial<SynthOptions>,
): SynthResult {
  const sampleRate = 44100;
  const duration = overrides?.duration ?? 120; // 2 分钟默认
  // 实际生成时 BPM 用于内层节奏
  const baseBpm = analysis.bpm > 0 ? analysis.bpm : 90;
  const bpm = Math.max(60, Math.min(120, baseBpm * 0.7)); // 拉到舒缓区间
  const seed = hashString(
    `${analysis.key}-${analysis.bpm}-${analysis.energy.toFixed(2)}`,
  );
  const rand = seededRandom(seed);
  // 静音使用
  void rand;

  const opts: SynthOptions = {
    duration,
    sampleRate,
    alphaHz: 10, // 默认 10Hz（Alpha 区间正中）
    volume: 0.55,
    seed,
    keyRoot: analysis.keyRoot,
    keyMode: analysis.keyMode,
    energy: analysis.energy,
    warmth: analysis.warmth,
    brightness: analysis.brightness,
    ...overrides,
  };

  // 1) 创建离线 context（单声道？我们要双声道因为双耳节拍）
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

  // 2) 主输出 + 混响链
  const mainOut = ctx.createGain();
  mainOut.gain.value = 1;
  const reverbOut = ctx.createGain();
  buildReverbChain(ctx, mainOut, reverbOut, 0.22);
  reverbOut.connect(ctx.destination);

  // 3) 乐器层
  const pad = new PadVoice(ctx);
  const bell = new BellVoice(ctx);
  const texture = new TextureVoice(ctx);

  // 4) 构建和弦进行
  const chords = buildChordSequence(opts);

  // 5) 演奏和弦（pad 多层）
  for (const chord of chords) {
    for (const note of chord) {
      // 过滤掉太刺耳的高音
      if (note.midi > 84) continue;
      const f = midiToFreq(note.midi);
      // pad 用 2 个略微失谐的 detune 叠加
      pad.play(
        f,
        note.start,
        note.end,
        note.velocity,
        800 + analysis.warmth * 2200,
        0.003,
      );
    }
  }
  pad.output.connect(mainOut);

  // 6) Bell 装饰音（按 bpm 触发，每个 beat 一颗的概率）
  const beatSec = 60 / bpm;
  let t = 4; // 4 拍后开始
  while (t < duration - 2) {
    if (Math.random() < 0.35 + analysis.energy * 0.3) {
      // 随机选一个当前和弦内的音
      const chord = chords[Math.floor(t / (beatSec * 8)) % chords.length];
      const note =
        chord[Math.floor(Math.random() * chord.length)];
      bell.play(midiToFreq(note.midi), t, 0.05 + analysis.brightness * 0.1);
    }
    t += beatSec;
  }
  bell.output.connect(mainOut);

  // 7) 噪声纹理（贯穿 2 段，模拟风声/海浪）
  texture.play(2, duration * 0.5, 600);
  texture.play(duration * 0.5, duration - 2, 900);
  texture.output.connect(mainOut);

  // 8) Alpha 双耳节拍（贯穿全程）
  const binaural = new BinauralBeat(ctx, opts.alphaHz);
  binaural.output.connect(ctx.destination);
  binaural.play(1, duration - 1, 0.06);

  // 9) 淡入淡出
  const fade = 1.5;
  const masterIn = ctx.createGain();
  masterIn.gain.setValueAtTime(0, 0);
  masterIn.gain.linearRampToValueAtTime(opts.volume ?? 0.55, fade);
  masterIn.gain.setValueAtTime(opts.volume ?? 0.55, duration - fade);
  masterIn.gain.linearRampToValueAtTime(0, duration);
  // 重新连接：把 mainOut 的输入连到 masterIn，masterIn 输出到 destination
  mainOut.disconnect();
  reverbOut.disconnect();
  mainOut.connect(masterIn);
  reverbOut.connect(masterIn);
  masterIn.connect(ctx.destination);
  binaural.output.disconnect();
  binaural.output.connect(masterIn);

  // 渲染
  // 使用 async-style：调用者会 await render()
  return {
    buffer: undefined as unknown as AudioBuffer, // 占位
    duration,
    bpm,
    chordCount: chords.length,
    // 暴露 ctx 让调用者 render
    _ctx: ctx,
  } as SynthResult & { _ctx: OfflineAudioContext };
}

/**
 * 实际渲染入口（异步）
 */
export async function renderAlphaMusic(
  analysis: AudioAnalysis,
  overrides?: Partial<SynthOptions>,
  onProgress?: (msg: string) => void,
): Promise<AudioBuffer> {
  onProgress?.('正在编排和弦进行…');
  await tick();
  const result = generateAlphaMusic(analysis, overrides);
  onProgress?.('正在合成 pad / bell / 纹理…');
  await tick();
  const ctx = (result as SynthResult & { _ctx: OfflineAudioContext })._ctx;
  onProgress?.('正在烘焙音频（' + Math.round(result.duration) + 's）…');
  const buf = await ctx.startRendering();
  onProgress?.('完成');
  return buf;
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
