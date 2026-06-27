# 🚀 xCompress

xCompress adalah aplikasi desktop native Windows yang dirancang khusus untuk mengompresi media berukuran besar (Video, Gambar, GIF, dan dokumen PDF) hingga **90% lebih kecil** secara **100% offline**, aman, dan sangat cepat menggunakan akselerasi perangkat keras kartu grafis (GPU).

Aplikasi ini mengusung desain antarmuka **Liquid Glass** premium bergaya modern dengan kontrol jendela khas Windows serta fitur seret dan lepas (Drag & Drop) tingkat sistem.

---

## ✨ Fitur Utama

- **100% Offline & Privat**: Berkas media Anda tidak pernah diunggah ke internet. Seluruh proses kompresi dilakukan secara lokal di komputer Anda.
- **Akselerasi Perangkat Keras (GPU)**: Mendukung deteksi otomatis encoder kartu grafis populer seperti **NVIDIA NVENC** (`h264_nvenc`), **Intel Quick Sync** (`h264_qsv`), dan **AMD AMF** (`h264_amf`) untuk kecepatan kompresi ekstrem.
- **Seret & Lepas (Drag & Drop)**: Seret berkas apa saja langsung dari Windows File Explorer ke area aplikasi untuk langsung dimasukkan ke antrean.
- **Dukungan Multi-Format**:
  - **Video**: MP4, MOV, MKV, WebM (dengan opsi resize resolusi hingga 4K/1080p/720p/480p dan hapus audio).
  - **Gambar**: JPEG, PNG, WebP (dengan pengaturan kualitas dari terendah hingga terbaik).
  - **GIF**: Menggunakan kompresi *2-Pass Palette* berkualitas tinggi.
  - **PDF**: Mengompresi resolusi gambar di dalam dokumen PDF secara efisien.
- **Custom Output Folder**: Pilih lokasi penyimpanan berkas kompresi secara kustom atau simpan di folder yang sama dengan berkas asli.
- **Indikator Jenis File Dinamis**: Menampilkan ringkasan tag visual file-file apa saja yang sedang masuk dalam antrean secara instan.

---

## 📊 Hasil Uji Coba & Benchmark

Pengujian dilakukan pada video **4K 60fps** berdurasi 10 detik (Ukuran asli: **177 MB**):

| Parameter | 💻 Software CPU (`libx264`) | 🚀 Hardware GPU NVIDIA (`h264_nvenc`) |
| :--- | :--- | :--- |
| **Waktu Encode** | **87.75 detik** (1m 27s) | **12.47 detik** (7x Lebih Cepat!) |
| **Kecepatan** | **7.0 FPS** (0.11x speed) | **54.0 FPS** (0.89x speed) |
| **Ukuran Output** | **18.3 MB** | **57.7 MB** |
| **Rasio Kompresi** | **90% Lebih Kecil** | **67% Lebih Kecil** |

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Vanilla CSS.
- **Backend (OS Shell)**: Rust & Tauri v2.
- **Compression Engines**: FFmpeg (Video, Gambar, GIF), Ghostscript (PDF).

---

## 📖 Cara Menggunakan

1. **Jalankan Aplikasi**: Buka aplikasi xCompress.
2. **Tambah File**: Seret berkas dari folder mana saja ke window xCompress atau klik area unggah/tombol import untuk memilih file.
3. **Pilih Pengaturan**:
   - Tentukan format output target dan resolusi.
   - Atur kualitas kompresi (Super / Tinggi / Medium / Kecil) atau pilih target ukuran file tertentu dalam megabyte (MB).
4. **Mulai Kompresi**: Klik tombol **Compress** di bagian kanan bawah.
5. **Akses Berkas**: Setelah selesai, hover pada berkas di antrean lalu klik **Show** untuk membuka lokasi file langsung di Windows Explorer.

---

## 📝 Changelog

### v0.1.0-rev3 (2026-06-28)
- **Fix Terminal Window**: Memperbaiki kemunculan popup window CMD di Windows dengan mengimplementasikan flag `CREATE_NO_WINDOW` (`0x08000000`) pada tokio subprocess Rust.
- **Local FFmpeg Locator**: Mengubah sistem pencarian `ffmpeg` agar memprioritaskan folder lokal `resources/bin/` aplikasi terlebih dahulu.
- **System Drag & Drop**: Mengintegrasikan listener tauri `tauri://drag-drop` untuk menangkap dropped file absolut dari sistem operasi Windows.
- **Windows-Style Window Chrome**: Desain Titlebar diposisikan di sebelah kanan dengan visual control Windows orisinal.
- **Settings Layout Scroll**: Panel kanan pengaturan dibuat scrollable secara independen sehingga tidak memotong elemen terbawah.

---

## 🚀 Kontribusi & Lisensi

Aplikasi ini bersifat gratis dan open-source di bawah lisensi GPL-3.0. Dibuat dan dikembangkan secara lokal untuk menghadirkan alternatif kompresi media yang cantik, instan, dan aman di Windows.
