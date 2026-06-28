# 🚀 xCompress

xCompress adalah aplikasi desktop native Windows yang dirancang khusus untuk mengompresi media berukuran besar (Video, Gambar, GIF, dan dokumen PDF) hingga **90% lebih kecil** secara **100% offline**, aman, dan sangat cepat menggunakan akselerasi perangkat keras kartu grafis (GPU).

Aplikasi ini mengusung desain antarmuka **Liquid Glass** premium bergaya modern dengan kontrol jendela khas Windows serta fitur seret dan lepas (Drag & Drop) tingkat sistem.

---

## ✨ Fitur Utama

- **100% Offline & Privat**: Berkas media Anda tidak pernah diunggah ke internet. Seluruh proses kompresi dilakukan secara lokal di komputer Anda.
- **Akselerasi Perangkat Keras (GPU)**: Mendukung deteksi otomatis encoder nyata melalui probe FFmpeg untuk **NVIDIA NVENC**, **Intel Quick Sync**, dan **AMD AMF**. Jika encoder terdaftar tetapi gagal dipakai, aplikasi otomatis fallback ke encoder yang berjalan.
- **Pilihan Encoder Video**: Mode **Auto Rekomendasi**, **H.265 CPU ukuran terbaik**, **H.265 GPU**, **H.264 GPU tercepat**, dan **H.264 CPU kompatibel**.
- **5 Preset Kualitas**: **Super**, **Tinggi**, **Medium**, **Kecil**, dan **Mini** untuk menyesuaikan kualitas, kecepatan, dan ukuran output.
- **Batch & Folder Processing**: Bisa menambahkan ratusan file sekaligus atau drop folder penuh; aplikasi mengekspansi folder secara recursive dan memproses antrean secara paralel terbatas dengan progress per file.
- **Seret & Lepas (Drag & Drop)**: Seret berkas apa saja langsung dari Windows File Explorer ke area aplikasi untuk langsung dimasukkan ke antrean.
- **Dukungan Multi-Format**:
  - **Video**: MP4, MOV, MKV, WebM, AVI, M4V, MPEG/MPG, 3GP, MTS/M2TS.
  - **Gambar**: JPEG, PNG, WebP, HEIC/HEIF, TIFF, BMP, DNG, dan RAW umum seperti CR2/NEF/ARW/RW2/RAF/ORF.
  - **Konversi RAW/DNG**: DNG/RAW/HEIC/TIFF dapat dikonversi ke JPEG/PNG/WebP, dengan prioritas `vips` atau `magick` jika tersedia.
  - **GIF**: Menggunakan `gifski` jika tersedia, fallback ke FFmpeg *2-Pass Palette* dengan FPS dan resolusi adaptif mengikuti preset kualitas.
  - **PDF**: Mengompresi dokumen image-heavy lewat Ghostscript, fallback ke `mutool` jika tersedia, dengan alert jika dependency PDF belum tersedia.
- **Before/After Preview**: File hasil kompresi dapat dibandingkan langsung dengan slider sebelum/sesudah.
- **Pixel Dimensions Overlay**: Preview menampilkan dimensi pixel input/output agar ukuran media bisa dicek tanpa membuka aplikasi lain.
- **Custom Output Folder**: Pilih lokasi penyimpanan berkas kompresi secara kustom atau simpan di folder yang sama dengan berkas asli.
- **Indikator Jenis File Dinamis**: Menampilkan ringkasan tag visual file-file apa saja yang sedang masuk dalam antrean secara instan.

---

## 📊 Hasil Riset & Benchmark Lokal

Sumber benchmark: `F:\2026\rkdrone\DCIM\compress-video\compressx\15158346_3840_2160_60fps.mp4`, video **4K 60fps H.264**, durasi **28,77 detik**, ukuran **177,2 MB**, bitrate sekitar **49,3 Mbps**. Benchmark di bawah memakai segmen 10 detik dari file yang sama.

| Encoder / Mode | Status | Waktu | Output | Bitrate | SSIM | Catatan |
| :--- | :--- | ---: | ---: | ---: | ---: | :--- |
| `h264_nvenc` VBR 20M / Balanced | Berhasil | 13,31 dtk | 25,62 MB | 21,49 Mbps | 0,9736 | Rekomendasi default: cepat, kualitas masih aman |
| `h264_nvenc` VBR 9M / Mini | Berhasil | 10,38 dtk | 10,64 MB | 8,92 Mbps | 0,9416 | Ukuran jauh lebih kecil, lebih agresif untuk chat/web |
| `libx265` CRF 24 ultrafast | Berhasil | 65,19 dtk | 23,12 MB | 19,40 Mbps | 0,9659 | Fallback CPU cepat relatif untuk x265, tetap jauh lebih lambat dari NVENC |
| `libx265` CRF 28 fast | Berhasil | 152,63 dtk | 16,90 MB | 14,17 Mbps | - | Ukuran lebih kecil, kualitas lebih agresif |
| `libx265` CRF 24 fast | Berhasil | 162,90 dtk | 30,50 MB | 25,59 Mbps | - | Kualitas lebih aman, sangat lambat |
| `hevc_nvenc` CQ 24/28 | Gagal | - | - | - | - | FFmpeg mencantumkan encoder, tetapi device lokal menolak: `No capable devices found` |
| `hevc_amf` / `h264_amf` | Gagal | - | - | - | - | Driver AMF lokal crash saat encode |
| `libsvtav1` CRF 34 preset 8 | Berhasil | 190,79 dtk | 35,31 MB | 29,62 Mbps | - | Terlalu lambat untuk default app |

Kesimpulan implementasi: **Auto Rekomendasi** mencoba H.265 GPU dulu, lalu H.264 GPU, lalu H.265 CPU. Untuk mesin benchmark ini, H.264 NVENC VBR 20M menjadi default paling seimbang. Preset **Mini** memakai batas 9M untuk kompresi cepat dan jauh lebih kecil, sedangkan fallback CPU x265 memakai `ultrafast` agar tidak terlalu lama saat GPU HEVC tidak tersedia.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Vanilla CSS.
- **Backend (OS Shell)**: Rust & Tauri v2.
- **Compression Engines**: FFmpeg (Video, Gambar, GIF), libwebp via FFmpeg, optional `vips`/ImageMagick for wide image/RAW conversion, optional `gifski`, optional `pngquant` + `oxipng`, Ghostscript or `mutool` for PDF.

---

## 📖 Cara Menggunakan

1. **Jalankan Aplikasi**: Buka aplikasi xCompress.
2. **Tambah File**: Seret berkas dari folder mana saja ke window xCompress atau klik area unggah/tombol import untuk memilih file.
   - Untuk batch besar, drop seluruh folder atau klik **Tambah Folder**. xCompress hanya memasukkan format media yang didukung.
3. **Pilih Pengaturan**:
   - Tentukan format output target dan resolusi.
   - Pilih encoder Auto atau manual, lalu atur kualitas kompresi (Super / Tinggi / Medium / Kecil / Mini) atau target ukuran file tertentu dalam megabyte (MB).
4. **Mulai Kompresi**: Klik tombol **Compress** di bagian kanan bawah.
5. **Akses Berkas**: Setelah selesai, hover pada berkas di antrean lalu klik **Show** untuk membuka lokasi file langsung di Windows Explorer.

---

## 📝 Changelog

### v0.1.0-rev3 (2026-06-28)
- **Better FFmpeg Encoder Selection**: Menambahkan mode encoder Auto/manual, H.265 CPU/GPU, H.264 GPU/CPU, probe hardware aktual, preset FFmpeg per encoder, dan target bitrate untuk H.264 hardware.
- **5 Quality Presets**: Menambahkan preset **Mini** dengan CRF 31 dan batas H.264 NVENC 9 Mbps untuk output jauh lebih kecil.
- **Improved Image/GIF/PDF Compression**: Menambahkan argumen FFmpeg yang lebih aman untuk JPEG/PNG/WebP, GIF palette adaptif, dan pesan Ghostscript yang lebih jelas untuk PDF.
- **Folder & Parallel Batch Compression**: Menambahkan recursive folder expansion dan pemrosesan paralel terbatas untuk antrean besar.
- **Wider Format Support**: Menambahkan deteksi AVI/M4V/MPEG/3GP/MTS/M2TS, HEIC/HEIF, TIFF, BMP, DNG, dan RAW umum.
- **Optional Best Tool Pipeline**: Menambahkan prioritas `vips`/`magick` untuk RAW/HEIC/TIFF, `gifski` untuk GIF, `pngquant` + `oxipng` untuk PNG, dan `mutool` fallback untuk PDF.
- **Preview Upgrade**: Menambahkan slider before/after, overlay dimensi pixel, dan update dimensi output setelah kompresi selesai.
- **UI Fixes**: Memperbaiki tombol remove/status yang tumpang tindih dan titlebar controls agar area import/history/settings tidak bertabrakan dengan tombol window.
- **Fix Terminal Window**: Memperbaiki kemunculan popup window CMD di Windows dengan mengimplementasikan flag `CREATE_NO_WINDOW` (`0x08000000`) pada tokio subprocess Rust.
- **Local FFmpeg Locator**: Mengubah sistem pencarian `ffmpeg` agar memprioritaskan folder lokal `resources/bin/` aplikasi terlebih dahulu.
- **System Drag & Drop**: Mengintegrasikan listener tauri `tauri://drag-drop` untuk menangkap dropped file absolut dari sistem operasi Windows.
- **Windows-Style Window Chrome**: Desain Titlebar diposisikan di sebelah kanan dengan visual control Windows orisinal.
- **Settings Layout Scroll**: Panel kanan pengaturan dibuat scrollable secara independen sehingga tidak memotong elemen terbawah.

---

## 🚀 Kontribusi & Lisensi

Aplikasi ini bersifat gratis dan open-source di bawah lisensi GPL-3.0. Dibuat dan dikembangkan secara lokal untuk menghadirkan alternatif kompresi media yang cantik, instan, dan aman di Windows.
