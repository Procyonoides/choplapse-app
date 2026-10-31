import { Injectable } from '@angular/core';
import { FFmpeg } from '@ffmpeg/ffmpeg';

export interface ChopOptions {
  interval: number;
  clipLen: number;
  mode: string;
  bg: string;
  blur: number;
  wmText: string;
  wmPos: string;
  music: File | null;
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class FfmpegService {
  private ffmpeg = new FFmpeg();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;

    this.ffmpeg.on('log', ({ message }) => console.log(message));

    await this.ffmpeg.load({
      classWorkerURL: '/assets/ffmpeg/worker.js',
      coreURL: '/assets/ffmpeg/ffmpeg-core.js',
      wasmURL: '/assets/ffmpeg/ffmpeg-core.wasm',
    });

    this.loaded = true;
  }

  async chop(
    file: File,
    opts: ChopOptions,
    onProgress: (persen: number) => void
  ): Promise<string> {
    const handler = ({ progress }: { progress: number }) => {
      onProgress(Math.min(100, Math.max(0, Math.round(progress * 100))));
    };
    this.ffmpeg.on('progress', handler);

    try {
      await this.ffmpeg.writeFile('input.mp4', new Uint8Array(await file.arrayBuffer()));

      const { interval, clipLen, mode, bg, blur, wmText, wmPos, music, duration } = opts;
      const base = `fps=30,select='lt(mod(t,${interval}),${clipLen})',setpts=N/(30*TB)`;
      let filter = base;

      let wm = '';
      if (wmText.trim()) {
        const res = await fetch('/assets/font.ttf');
        const fontData = new Uint8Array(await res.arrayBuffer());
        if (!res.ok || fontData.length < 10000) {
          throw new Error('font.ttf tidak ditemukan di src/assets');
        }
        await this.ffmpeg.writeFile('font.ttf', fontData);
        await this.ffmpeg.writeFile('wm.txt', new TextEncoder().encode(wmText.trim()));

        const posMap: Record<string, string> = {
          top: 'h*0.06',
          middle: '(h-text_h)/2',
          bottom: 'h*0.94-text_h',
        };

        wm = `,drawtext=fontfile=font.ttf:textfile=wm.txt:expansion=none:fontsize=w/20:fontcolor=white@0.85:borderw=2:bordercolor=black:x=(w-text_w)/2:y=${posMap[wmPos]}`;
      }

      if (mode === 'fit') {
        filter += `,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
      } else if (mode === 'crop') {
        filter += `,crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920,setsar=1`;
      } else if (mode === 'crop34') {
        filter += `,crop='min(iw,ih*3/4)':'min(ih,iw*4/3)',scale=1080:1440,pad=1080:1920:0:240:black,setsar=1`;
      } else if (mode === 'crop43') {
        filter += `,crop='min(iw,ih*4/3)':'min(ih,iw*3/4)',scale=1080:810,pad=1080:1920:0:555:black,setsar=1`;
      }

      const fgFilters: Record<string, string> = {
        fit: `scale=1080:1920:force_original_aspect_ratio=decrease`,
        crop34: `crop='min(iw,ih*3/4)':'min(ih,iw*4/3)',scale=1080:1440`,
        crop43: `crop='min(iw,ih*4/3)':'min(ih,iw*3/4)',scale=1080:810`,
      };

      filter += wm;

      let videoArgs: string[] = ['-vf', filter, '-map', '0:v'];

      if (bg !== 'dark' && fgFilters[mode]) {
        const bgChain = bg === 'blur'
          ? `scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=${blur}:3,scale=1080:1920`
          : `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;

        const complex =
          `[0:v]${base},split=2[a][b];` +
          `[a]${bgChain}[bg];` +
          `[b]${fgFilters[mode]}[fg];` +
          `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1${wm}[v]`;

        videoArgs = ['-filter_complex', complex, '-map', '[v]'];
      }

      let audioInputs: string[] = [];
      let audioArgs: string[] = ['-an'];

      if (music) {
        await this.ffmpeg.writeFile('music.mp3', new Uint8Array(await music.arrayBuffer()));

        const fullClips = Math.floor(duration / interval);
        const sisa = duration - fullClips * interval;
        const outDur = fullClips * clipLen + Math.min(sisa, clipLen);
        const fade = Math.min(1.5, outDur / 2);
        const fadeStart = Math.max(0, outDur - fade);

        audioInputs = ['-i', 'music.mp3'];
        audioArgs = [
          '-map', '1:a',
          '-af', `afade=t=in:d=0.5,afade=t=out:st=${fadeStart}:d=${fade}`,
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
        ];
      }

      await this.ffmpeg.exec([
        '-i', 'input.mp4',
        ...audioInputs,
        ...videoArgs,
        ...audioArgs,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        'output.mp4',
      ]);

      const data = (await this.ffmpeg.readFile('output.mp4')) as Uint8Array;
      return URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' }));
    } finally {
      this.ffmpeg.off('progress', handler);
    }
  }
}