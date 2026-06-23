import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Noto_Sans_SC } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-noto-sans-sc',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Alpha Wave · 脑波音乐生成器',
  description:
    '上传任意歌曲，AI 解构其 BPM、调性、情绪与能量曲线，程序化合成一段完全原创的 ambient 音乐并嵌入 8–12Hz Alpha 双耳节拍，助你进入专注与放松。',
  keywords: [
    'Alpha 脑波',
    '双耳节拍',
    'Binaural Beats',
    'Ambient',
    'AI 音乐生成',
    '专注音乐',
    '冥想音乐',
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`dark ${inter.variable} ${jetbrainsMono.variable} ${notoSansSC.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
