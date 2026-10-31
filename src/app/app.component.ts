import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FfmpegService } from './ffmpeg.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'choplapse-app';
  private ffmpegService = inject(FfmpegService);
  status = signal('Memuat FFmpeg...');

  selectedFile: File | null = null;
  fileInfo = signal('');
  previewUrl = signal('');
  duration = signal(0);

  interval = 5;
  clipLen = 0.3;
  target: number | null = null;
  mode = 'fit';
  bg = 'blur';
  blur = 10;
  wmText = '';
  wmPos = 'bottom';

  processing = signal(false);
  progress = signal(0);
  resultUrl = signal('');

  async startChop() {
    if (!this.selectedFile) {
      alert('Pilih video dulu, boss.');
      return;
    }

    const clipLen = this.clipLen;
    let interval = this.interval;

    if (this.target && this.target > 0) {
      interval = (this.duration() * clipLen) / this.target;
      this.interval = Math.round(interval * 100) / 100;
    }

    if (clipLen >= interval) {
      alert('Panjang potongan harus lebih kecil dari interval.');
      return;
    }

    this.processing.set(true);
    this.progress.set(0);
    this.status.set('Memproses...');

    try {
      const url = await this.ffmpegService.chop(
        this.selectedFile,
        {
          interval, clipLen,
          mode: this.mode, bg: this.bg, blur: this.blur,
          wmText: this.wmText, wmPos: this.wmPos,
        },
        (persen) => {
          this.progress.set(persen);
          this.status.set(`Memproses... ${persen}%`);
        }
      );
      this.resultUrl.set(url);
      this.progress.set(100);
      this.status.set('Selesai!');
    } catch (err) {
      this.status.set('Gagal memproses, cek console.');
      console.error(err);
    }

    this.processing.set(false);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.selectedFile = file;
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    this.fileInfo.set(`${file.name} (${sizeMB} MB)`);
    this.previewUrl.set(URL.createObjectURL(file));
  }

  onMetadata(event: Event) {
    const video = event.target as HTMLVideoElement;
    this.duration.set(video.duration);
    this.fileInfo.update(info => `${info} - durasi ${video.duration.toFixed(1)} detik`);
  }

  async ngOnInit() {
    try {
      await this.ffmpegService.load();
      this.status.set('FFmpeg siap dipakai!');
    } catch (err) {
      this.status.set('Gagal memuat FFmpeg, cek console.');
      console.error(err);
    }
  }
}
