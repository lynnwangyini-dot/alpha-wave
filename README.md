# 🎵 Alpha Wave · Brainwave Music Generator

> Upload any song you love → extract its **BPM / key / mood / energy curve** → AI **procedurally synthesizes** a fully original ambient track → embed **8–12Hz Alpha binaural beats** → play in browser or download as WAV

![tech](https://img.shields.io/badge/100%25_Client_Side-Web_Audio_API-8B5CF6?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-22D3EE?style=flat-square)
![privacy](https://img.shields.io/badge/Audio_Never_Leaves_Your_Browser-Zero_Upload-F472B6?style=flat-square)

## ✨ Key Features

- 🔒 **Zero Upload** — Audio is decoded and analyzed entirely in-browser (Web Audio API). It never leaves your device.
- 🎵 **100% Original Synthesis** — Ambient music is generated from feature parameters, never reusing the original track's samples.
- 🧬 **Alpha Binaural Beats** — Adjustable 8–12Hz frequency difference between L/R channels for focus / relaxation.
- 📊 **4-Dimensional Feature Analysis** — BPM · Key · Mood · Energy curve.
- 🎚️ **Tunable Parameters** — Beat frequency, carrier base, generation duration, mix ratio.
- ⬇️ **WAV Download** — Baked via `OfflineAudioContext`, 16-bit / 44.1kHz stereo.

## 🚀 Quick Start

### Local development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5000](http://localhost:5000)

### Production build

```bash
pnpm build
pnpm start
```

## 🌐 Deploy to Vercel (Free, 1-Click)

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "feat: alpha wave music generator"
git branch -M main
git remote add origin https://github.com/<your-username>/alpha-wave.git
git push -u origin main
```

### Step 2 — Import on Vercel

1. Open https://vercel.com/new
2. Select your GitHub repo `alpha-wave`
3. Framework Preset is auto-detected as **Next.js**
4. Click **Deploy**

### Step 3 — Get your free domain

Wait 1–2 minutes. Vercel auto-assigns `https://alpha-wave-xxx.vercel.app` — your site is live.

> 💡 Want your own domain later? See [DEPLOY.md](./DEPLOY.md).

## 🏗️ Technical Architecture

| Module | Implementation | File |
|---|---|---|
| Audio decoding | Web Audio API · `AudioContext.decodeAudioData` | `src/lib/audio-analysis.ts` |
| BPM detection | Autocorrelation + peak detection (60–180 BPM range) | `src/lib/audio-analysis.ts` |
| Key detection | FFT + 12 pitch-class energy + Krumhansl–Schmuckler templates | `src/lib/audio-analysis.ts` |
| Mood vector | RMS energy + spectral centroid + ZCR + rhythmicity → 8-dim feature | `src/lib/audio-analysis.ts` |
| Energy curve | 1-second window RMS, smoothed, normalized | `src/lib/audio-analysis.ts` |
| Ambient synthesis | 4-layer oscillators: low drone / chord pad / bell / shimmer | `src/lib/music-synth.ts` |
| Alpha beats | L/R channel frequency offset 8–12Hz, carrier 80–440Hz tunable | `src/lib/music-synth.ts` |
| WAV encoding | 16-bit PCM · stereo · 44.1kHz | `src/lib/wav-encoder.ts` |
| Real-time playback | AudioContext + AnalyserNode spectrum visualization | `src/app/page.tsx` |
| Offline rendering | `OfflineAudioContext` for downloadable WAV | `src/lib/music-synth.ts` |

## 🎨 Design System

- **Visual style**: Deep-space dark theme (`#070712` void) + neon violet (`#8B5CF6`) + cyan pulse (`#22D3EE`)
- **Typography**: JetBrains Mono (numerics) + Inter (body) + Noto Sans SC (CJK fallback)
- **Components**: shadcn/ui (Radix UI) + Tailwind CSS 4 + Framer Motion
- **Responsive**: 1024+ horizontal three-zone / 640–1024 stacked / <640 single column

See [DESIGN.md](./DESIGN.md) for the full design spec.

## 🛡️ Privacy & Copyright

- ✅ Audio files are never uploaded to any server
- ✅ Generated music does not reuse samples from the input track (no copyright risk)
- ✅ No cookies · no tracking · no login required
- ✅ Open source — every line of frontend code is auditable

## 📦 Project Structure

```
.
├── src/
│   ├── app/
│   │   ├── globals.css        # Design tokens + global styles
│   │   ├── layout.tsx         # Root layout + font injection
│   │   └── page.tsx           # Main interactive page
│   ├── components/ui/         # shadcn/ui components
│   └── lib/
│       ├── audio-analysis.ts  # Audio feature extraction
│       ├── music-synth.ts     # Procedural synthesis engine
│       ├── wav-encoder.ts     # WAV encoder
│       └── utils.ts           # cn() helper
├── DESIGN.md                  # Design specification
├── DEPLOY.md                  # Deployment guide (Vercel / Docker / Cloudflare)
├── vercel.json                # Vercel deployment config
└── Dockerfile                 # Docker deployment config
```

## 📄 License

MIT License

## 🙏 Credits

- [Next.js](https://nextjs.org) · [React](https://react.dev)
- [shadcn/ui](https://ui.shadcn.com) · [Radix UI](https://www.radix-ui.com)
- [Tailwind CSS](https://tailwindcss.com) · [Framer Motion](https://www.framer.com/motion/)
- [Lucide Icons](https://lucide.dev)

---

Made with 🧠 + 🎵 — *Acoustic science · Procedural generation · Zero copyright risk*
