'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import {
  Activity,
  AudioLines,
  Download,
  Music4,
  Pause,
  Play,
  Radio,
  Sparkles,
  Upload,
  Waves,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';

import {
  analyzeAudio,
  decodeAudioFile,
  type AudioAnalysis,
} from '@/lib/audio-analysis';
import { renderAlphaMusic } from '@/lib/music-synth';
import { audioBufferToWav, downloadBlob } from '@/lib/wav-encoder';

type Stage =
  | 'idle'
  | 'analyzing'
  | 'analyzed'
  | 'generating'
  | 'generated'
  | 'playing'
  | 'paused'
  | 'error';

interface StatusInfo {
  stage: Stage;
  message?: string;
}

const PRESET_DURATIONS = [60, 120, 300, 600];
const PRESET_FREQS = [8, 10, 12];

export default function HomePage() {
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [alphaHz, setAlphaHz] = useState(10);
  const [duration, setDuration] = useState(120);
  const [generated, setGenerated] = useState<AudioBuffer | null>(null);
  const [progress, setProgress] = useState('');
  const [status, setStatus] = useState<StatusInfo>({ stage: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const stopPlaybackRef = useRef<(reset?: boolean) => void>(() => {});

  // ---------------- Playback control (wrapped in ref to avoid temporal deps) ----------------
  const ensureAudioCtx = () => {
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  };

  // ---------------- Upload + analysis ----------------
  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!file.type.includes('audio') && !/\.(mp3|wav)$/i.test(file.name)) {
      setError('Only mp3 / wav files are supported');
      return;
    }
    setError(null);
    setFileName(file.name);
    setStatus({ stage: 'analyzing', message: 'Decoding audio…' });
    setAnalysis(null);
    setGenerated(null);
    stopPlaybackRef.current(true);
    try {
      const buffer = await decodeAudioFile(file);
      setStatus({
        stage: 'analyzing',
        message: 'Analyzing BPM / Key / Mood…',
      });
      // Important: decode is already expensive, give the UI a chance to refresh
      await new Promise((r) => setTimeout(r, 30));
      const result = analyzeAudio(buffer);
      setAnalysis(result);
      setStatus({ stage: 'analyzed' });
    } catch (e) {
      console.error(e);
      setError(
        'Decoding failed. Please make sure this is a valid mp3/wav file (recommended under 5 min — some encodings are not supported by browsers).',
      );
      setStatus({ stage: 'error' });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/mpeg': ['.mp3'],
      'audio/wav': ['.wav'],
      'audio/x-wav': ['.wav'],
    },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024, // 50MB
    noClick: false,
    noKeyboard: false,
  });

  // ---------------- Generation ----------------
  const handleGenerate = async () => {
    if (!analysis) return;
    setStatus({ stage: 'generating', message: 'Orchestrating chord progression…' });
    setError(null);
    setGenerated(null);
    stopPlaybackRef.current(true);
    try {
      const buf = await renderAlphaMusic(
        analysis,
        { alphaHz, duration },
        (msg) => setProgress(msg),
      );
      setGenerated(buf);
      setStatus({ stage: 'generated' });
      setProgress('');
    } catch (e) {
      console.error(e);
      setError('Generation failed: ' + (e as Error).message);
      setStatus({ stage: 'error' });
    }
  };

  // Release previous generation URL
  useEffect(() => {
    if (generated) {
      const blob = audioBufferToWav(generated);
      const url = URL.createObjectURL(blob);
      setAudioURL(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setAudioURL(null);
    }
  }, [generated]);

  // ---------------- Playback ----------------
  const stopPlayback = (reset = false) => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (analyser) {
      try {
        analyser.disconnect();
      } catch {}
      setAnalyser(null);
    }
    if (reset) {
      setCurrentTime(0);
      pauseOffsetRef.current = 0;
    }
    setIsPlaying(false);
  };
  // Sync stopPlayback into the ref (in effect, not in render)
  useEffect(() => {
    stopPlaybackRef.current = stopPlayback;
  });

  const startPlayback = () => {
    if (!generated) return;
    const ctx = ensureAudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const src = ctx.createBufferSource();
    src.buffer = generated;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    src.start(0, pauseOffsetRef.current % generated.duration);
    startTimeRef.current = ctx.currentTime - pauseOffsetRef.current;
    sourceRef.current = src;
    setAnalyser(analyser);
    setIsPlaying(true);
    setStatus({ stage: 'playing' });
    src.onended = () => {
      if (sourceRef.current === src) {
        stopPlayback(true);
        setStatus({ stage: 'generated' });
      }
    };
    tickProgress(ctx);
  };

  const tickProgress = (ctx: AudioContext) => {
    if (!sourceRef.current) return;
    const elapsed = ctx.currentTime - startTimeRef.current;
    setCurrentTime(Math.min(elapsed, generated?.duration ?? 0));
    rafRef.current = requestAnimationFrame(() => tickProgress(ctx));
  };

  const handlePlayPause = () => {
    if (!generated) return;
    if (isPlaying) {
      const ctx = audioCtxRef.current;
      if (ctx) {
        pauseOffsetRef.current = ctx.currentTime - startTimeRef.current;
      }
      stopPlayback(false);
      setStatus({ stage: 'paused' });
    } else {
      startPlayback();
    }
  };

  // ---------------- Download ----------------
  const handleDownload = () => {
    if (!generated) return;
    const blob = audioBufferToWav(generated);
    const base = fileName?.replace(/\.[^.]+$/, '') ?? 'song';
    downloadBlob(blob, `${base}-alpha-${alphaHz}Hz.wav`);
  };

  // ---------------- Unmount cleanup ----------------
  useEffect(() => {
    return () => {
      stopPlaybackRef.current(true);
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return (
    <main className="relative min-h-screen text-[var(--text-primary)]">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 -z-10 grid-bg opacity-40" />
      <div className="pointer-events-none fixed -top-40 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-violet-500/10 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-0 right-0 -z-10 h-[400px] w-[400px] rounded-full bg-cyan-500/8 blur-[100px]" />

      {/* ===== Hero + Upload ===== */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-12">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex items-center gap-2">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl box-glow">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 opacity-30" />
              <Waves className="relative h-5 w-5 text-violet-300" />
            </div>
            <span className="font-mono-num text-lg font-semibold tracking-[0.2em] text-white">
              ALPHA · WAVE
            </span>
          </div>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Turn the song you love<br className="md:hidden" />
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-300 to-cyan-400 bg-clip-text text-transparent text-glow">
              {' '}
              into an Alpha Wave
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--text-muted)] md:text-base">
            Upload any mp3 / wav song — we extract its BPM, key, mood and
            energy curve, then procedurally synthesize a fully original
            ambient track and embed 8–12Hz binaural beats. No samples,
            no copyright risk — just a faster path into focus.
          </p>
        </div>

        {/* Upload card */}
        <div
          {...getRootProps()}
          className={`group relative mx-auto mt-12 max-w-2xl cursor-pointer overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-10 text-center transition-all ${
            isDragActive
              ? 'border-violet-500/50 bg-violet-500/5'
              : 'hover:border-violet-500/30 hover:bg-white/[0.04]'
          }`}
        >
          <input {...getInputProps()} />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/50 to-transparent" />
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-500/20 bg-violet-500/10">
              <Upload className="h-6 w-6 text-violet-300" />
            </div>
            <div className="font-mono-num text-xs tracking-widest text-[var(--text-muted)]">
              {isDragActive ? 'Drop to start analysis' : 'DROP · OR · CLICK'}
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              mp3 / wav supported · up to 50MB · recommended under 5 min
            </p>
            {fileName && (
              <p className="mt-2 font-mono-num text-xs text-cyan-300/80">
                {fileName}
              </p>
            )}
          </div>
        </div>

        {error && (
          <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-rose-300/80">
            {error}
          </p>
        )}
      </section>

      {/* ===== Analysis results ===== */}
      <AnimatePresence>
        {analysis && (
          <motion.section
            key="analysis"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mx-auto max-w-6xl px-6 pb-12"
          >
            <div className="mb-6 flex items-center gap-3">
              <Badge
                variant="outline"
                className="border-violet-500/30 bg-violet-500/10 font-mono-num text-xs tracking-widest text-violet-300"
              >
                <Activity className="mr-1.5 h-3 w-3" />
                ANALYSIS · 01
              </Badge>
              <div className="h-px flex-1 bg-gradient-to-r from-violet-500/30 to-transparent" />
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                label="BPM"
                value={analysis.bpm.toString()}
                unit="BPM"
                icon={<Zap className="h-3.5 w-3.5" />}
                accent="violet"
              />
              <StatCard
                label="KEY"
                value={analysis.keyRoot}
                unit={analysis.keyMode === 'major' ? 'Major' : 'Minor'}
                icon={<Music4 className="h-3.5 w-3.5" />}
                accent="cyan"
              />
              <StatCard
                label="MOOD"
                value={analysis.mood.split(' · ')[0]}
                unit={analysis.mood.split(' · ')[1] ?? ''}
                icon={<Sparkles className="h-3.5 w-3.5" />}
                accent="rose"
              />
              <StatCard
                label="ENERGY"
                value={(analysis.energy * 100).toFixed(0)}
                unit="%"
                icon={<Radio className="h-3.5 w-3.5" />}
                accent="violet"
              />
            </div>

            {/* Energy curve */}
            <div className="mt-3 rounded-2xl border border-white/5 bg-white/[0.02] p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono-num text-xs tracking-widest text-[var(--text-muted)]">
                  ENERGY · CURVE
                </span>
                <span className="font-mono-num text-xs text-[var(--text-muted)]">
                  {analysis.duration.toFixed(1)}s · {analysis.sampleRate}Hz
                </span>
              </div>
              <EnergyCurve curve={analysis.energyCurve} />
              <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-[var(--text-muted)]">
                <Mini label="BRIGHTNESS" value={analysis.brightness} />
                <Mini label="WARMTH" value={analysis.warmth} />
                <Mini label="RHYTHMICITY" value={analysis.rhythmicity} />
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ===== Generate & Play ===== */}
      <AnimatePresence>
        {analysis && (
          <motion.section
            key="gen"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mx-auto max-w-6xl px-6 pb-24"
          >
            <div className="mb-6 flex items-center gap-3">
              <Badge
                variant="outline"
                className="border-cyan-500/30 bg-cyan-500/10 font-mono-num text-xs tracking-widest text-cyan-300"
              >
                <AudioLines className="mr-1.5 h-3 w-3" />
                GENERATE · 02
              </Badge>
              <div className="h-px flex-1 bg-gradient-to-r from-cyan-500/30 to-transparent" />
            </div>

            <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
              {/* Parameter panel */}
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
                <ParamRow
                  label="ALPHA · FREQUENCY"
                  hint="8-12Hz · default 10Hz · relaxation / light meditation"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono-num text-2xl font-semibold text-cyan-300 text-glow-cyan">
                      {alphaHz}
                    </span>
                    <span className="font-mono-num text-xs text-[var(--text-muted)]">
                      Hz
                    </span>
                  </div>
                  <Slider
                    min={8}
                    max={12}
                    step={0.5}
                    value={[alphaHz]}
                    onValueChange={(v) => setAlphaHz(v[0])}
                    className="mt-3"
                  />
                  <div className="mt-2 flex gap-1">
                    {PRESET_FREQS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setAlphaHz(f)}
                        className={`flex-1 rounded-md border px-2 py-1 font-mono-num text-xs transition ${
                          alphaHz === f
                            ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                            : 'border-white/5 text-[var(--text-muted)] hover:border-white/10 hover:text-white'
                        }`}
                      >
                        {f} Hz
                      </button>
                    ))}
                  </div>
                </ParamRow>

                <div className="my-6 h-px bg-white/5" />

                <ParamRow label="DURATION" hint="2–10 min recommended">
                  <div className="flex items-center gap-3">
                    <span className="font-mono-num text-2xl font-semibold text-violet-300 text-glow">
                      {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}
                    </span>
                    <span className="font-mono-num text-xs text-[var(--text-muted)]">
                      mm:ss
                    </span>
                  </div>
                  <Slider
                    min={30}
                    max={600}
                    step={30}
                    value={[duration]}
                    onValueChange={(v) => setDuration(v[0])}
                    className="mt-3"
                  />
                  <div className="mt-2 flex gap-1">
                    {PRESET_DURATIONS.map((d) => (
                      <button
                        key={d}
                        onClick={() => setDuration(d)}
                        className={`flex-1 rounded-md border px-2 py-1 font-mono-num text-xs transition ${
                          duration === d
                            ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                            : 'border-white/5 text-[var(--text-muted)] hover:border-white/10 hover:text-white'
                        }`}
                      >
                        {d < 60 ? `${d}s` : `${d / 60}m`}
                      </button>
                    ))}
                  </div>
                </ParamRow>

                <div className="mt-6 flex items-center gap-3">
                  <Button
                    onClick={handleGenerate}
                    disabled={status.stage === 'generating'}
                    className="group relative flex-1 overflow-hidden rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 px-6 py-6 text-sm font-medium text-white shadow-[0_0_30px_-5px_rgba(139,92,246,0.5)] hover:shadow-[0_0_40px_-5px_rgba(139,92,246,0.7)] disabled:opacity-50"
                  >
                    {status.stage === 'generating' ? (
                      <span className="flex items-center gap-2">
                        <Spinner />
                        {progress || 'Generating…'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        Generate Alpha Music
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {/* Player */}
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono-num text-xs tracking-widest text-[var(--text-muted)]">
                    PLAYER
                  </span>
                  {generated && (
                    <span className="font-mono-num text-[10px] tracking-widest text-cyan-300/80">
                      <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-cyan-400" />
                      {alphaHz}Hz · {generated.numberOfChannels === 2 ? 'STEREO' : 'MONO'}
                    </span>
                  )}
                </div>

                <Visualizer
                  analyser={analyser}
                  isPlaying={isPlaying}
                  alphaHz={alphaHz}
                />

                {/* Progress bar */}
                <div className="mt-5">
                  <div className="flex items-center justify-between font-mono-num text-[10px] text-[var(--text-muted)]">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(generated?.duration ?? 0)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all"
                      style={{
                        width: generated
                          ? `${(currentTime / generated.duration) * 100}%`
                          : '0%',
                      }}
                    />
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <Button
                    onClick={handlePlayPause}
                    disabled={!generated}
                    className="h-12 w-12 rounded-full border border-white/10 bg-white/[0.04] p-0 text-white hover:bg-white/[0.08] disabled:opacity-30"
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="ml-0.5 h-4 w-4" />
                    )}
                  </Button>
                  <div className="flex-1 font-mono-num text-xs text-[var(--text-muted)]">
                    {generated
                      ? isPlaying
                        ? 'Playing · wear headphones to feel the binaural beat'
                        : status.stage === 'paused'
                          ? 'Paused'
                          : 'Ready to play'
                      : 'Awaiting generation'}
                  </div>
                  <Button
                    onClick={handleDownload}
                    disabled={!generated}
                    className="h-10 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs text-white hover:bg-white/[0.08] disabled:opacity-30"
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    WAV
                  </Button>
                </div>
                {audioURL && (
                  <audio
                    controls
                    src={audioURL}
                    className="mt-3 h-8 w-full opacity-60"
                    style={{ filter: 'invert(0.85) hue-rotate(180deg)' }}
                  />
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Bottom status bar */}
      <footer className="mx-auto max-w-6xl px-6 pb-8">
        <div className="flex items-center justify-between font-mono-num text-[10px] tracking-widest text-[var(--text-muted)]">
          <span>ALPHA · WAVE / v0.1</span>
          <span>
            {status.stage === 'analyzing' && `ANALYZING · ${status.message}`}
            {status.stage === 'generating' && `GENERATING · ${status.message}`}
            {status.stage === 'playing' && 'PLAYING · STEREO · BINAURAL'}
            {status.stage === 'paused' && 'PAUSED'}
            {status.stage === 'generated' && 'READY · CLICK PLAY'}
            {status.stage === 'analyzed' && 'ANALYZED · CHOOSE PARAMETERS'}
            {status.stage === 'idle' && 'AWAITING INPUT'}
          </span>
        </div>
      </footer>
    </main>
  );
}

/* ===== Subcomponents ===== */

function StatCard({
  label,
  value,
  unit,
  icon,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  accent: 'violet' | 'cyan' | 'rose';
}) {
  const accentMap = {
    violet: 'text-violet-300 text-glow',
    cyan: 'text-cyan-300 text-glow-cyan',
    rose: 'text-rose-300',
  };
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono-num text-[10px] tracking-widest text-[var(--text-muted)]">
          {label}
        </span>
        <span className={accentMap[accent]}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono-num text-3xl font-semibold ${accentMap[accent]}`}>
          {value}
        </span>
        {unit && (
          <span className="font-mono-num text-[10px] text-[var(--text-muted)]">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-mono-num tracking-widest">{label}</div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-cyan-400"
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

function ParamRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono-num text-xs tracking-widest text-[var(--text-muted)]">
          {label}
        </span>
        {hint && (
          <span className="font-mono-num text-[10px] text-[var(--text-muted)]">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function EnergyCurve({ curve }: { curve: number[] }) {
  const w = 800;
  const h = 80;
  const path = curve
    .map((v, i) => {
      const x = (i / (curve.length - 1)) * w;
      const y = h - v * h * 0.95;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-20 w-full"
    >
      <defs>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="curveStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#curveFill)" />
      <path
        d={path}
        fill="none"
        stroke="url(#curveStroke)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Visualizer({
  analyser,
  isPlaying,
  alphaHz,
}: {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  alphaHz: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx2d.clearRect(0, 0, W, H);

      // Background grid lines
      ctx2d.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx2d.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (H / 4) * i;
        ctx2d.beginPath();
        ctx2d.moveTo(0, y);
        ctx2d.lineTo(W, y);
        ctx2d.stroke();
      }

      // Spectrum
      if (analyser && isPlaying) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const bars = 64;
        const step = Math.floor(data.length / bars);
        for (let i = 0; i < bars; i++) {
          const v = data[i * step] / 255;
          const x = (i / bars) * W;
          const barW = W / bars - 2;
          const barH = v * H * 0.9;
          const grad = ctx2d.createLinearGradient(0, H, 0, H - barH);
          grad.addColorStop(0, '#22D3EE');
          grad.addColorStop(1, '#8B5CF6');
          ctx2d.fillStyle = grad;
          ctx2d.fillRect(x, H - barH, barW, barH);
        }
      } else {
        // Placeholder
        ctx2d.fillStyle = 'rgba(139, 92, 246, 0.08)';
        ctx2d.fillRect(0, H * 0.5, W, 1);
      }

      // Binaural beat phase indicator (L / R)
      phaseRef.current += (alphaHz / 60) * 0.1; // visual phase increment
      if (phaseRef.current > 2 * Math.PI) phaseRef.current -= 2 * Math.PI;
      const cy = H * 0.18;
      const leftX = W * 0.25;
      const rightX = W * 0.75;
      const r = 16;
      const drawCircle = (x: number, phaseShift: number) => {
        const phase = phaseRef.current + phaseShift;
        const intensity = 0.5 + 0.5 * Math.sin(phase);
        ctx2d.beginPath();
        ctx2d.arc(x, cy, r, 0, 2 * Math.PI);
        ctx2d.strokeStyle = `rgba(139, 92, 246, ${0.2 + intensity * 0.6})`;
        ctx2d.lineWidth = 1.5;
        ctx2d.stroke();
        ctx2d.beginPath();
        ctx2d.arc(x, cy, r * intensity * 0.9, 0, 2 * Math.PI);
        ctx2d.fillStyle = `rgba(34, 211, 238, ${0.3 + intensity * 0.4})`;
        ctx2d.fill();
        ctx2d.fillStyle = 'rgba(255,255,255,0.6)';
        ctx2d.font = '9px JetBrains Mono';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(
          phaseShift === 0 ? 'L' : 'R',
          x,
          cy + 3,
        );
      };
      drawCircle(leftX, 0);
      drawCircle(rightX, Math.PI / 4);

      // Center line
      ctx2d.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx2d.beginPath();
      ctx2d.moveTo(W * 0.5, 0);
      ctx2d.lineTo(W * 0.5, H);
      ctx2d.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, isPlaying, alphaHz]);

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-black/30">
      <canvas
        ref={canvasRef}
        width={800}
        height={160}
        className="h-40 w-full"
      />
    </div>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
