// ═══════════════════════════════════════════════════════════════
// src-tauri/src/lib.rs
// xCompress — Tauri backend commands with hidden console window creation flags
// ═══════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ─── Helper: create command without terminal window ───────────
fn create_command<P: AsRef<Path>>(program: P) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program.as_ref());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

// ─── Types ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub gpu_type: String,   // "nvidia" | "intel" | "amd" | "cpu"
    pub label: String,
    pub encoder: String,    // e.g. "h264_nvenc"
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompressRequest {
    pub id: String,
    pub input_path: String,
    pub output_path: String,
    pub file_type: String,      // "video" | "image" | "gif" | "pdf"
    pub video_format: String,   // "MP4" | "MOV" | "MKV" | "WebM"
    pub video_quality: String,  // "CRF" | "File size"
    pub crf_value: u32,
    pub target_kb: u64,
    pub resolution: String,     // "Same as input" | "1080p" | "720p" ...
    pub remove_audio: bool,
    pub image_quality: String,  // "Highest" | "Good" | "Balanced" | "Small"
    pub image_format: String,   // "JPEG" | "PNG" | "WebP"
    pub pdf_quality: String,
    pub encoder: String,        // "h264_nvenc" | "h264_qsv" | "libx264" etc.
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub id: String,
    pub progress: f64,   // 0.0 – 100.0
    pub status: String,  // "compressing" | "done" | "error"
    pub compressed_size: Option<u64>,
    pub output_path: Option<String>,
    pub error_msg: Option<String>,
}

// ─── Helper: find ffmpeg / ffprobe ────────────────────────────

fn find_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(res_dir) = app.path().resource_dir() {
        let local_path = res_dir.join("bin").join("ffmpeg.exe");
        if local_path.exists() {
            return Some(local_path);
        }
        let local_path_root = res_dir.join("ffmpeg.exe");
        if local_path_root.exists() {
            return Some(local_path_root);
        }
    }
    which::which("ffmpeg").ok()
}

fn find_ffprobe(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(res_dir) = app.path().resource_dir() {
        let local_path = res_dir.join("bin").join("ffprobe.exe");
        if local_path.exists() {
            return Some(local_path);
        }
        let local_path_root = res_dir.join("ffprobe.exe");
        if local_path_root.exists() {
            return Some(local_path_root);
        }
    }
    which::which("ffprobe").ok()
}

// ─── Helper: get video duration via ffprobe ───────────────────

async fn get_video_duration_secs(app: &AppHandle, input: &str) -> Option<f64> {
    let ffprobe = find_ffprobe(app)?;
    let out = create_command(ffprobe)
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            input,
        ])
        .output()
        .await
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    s.trim().parse::<f64>().ok()
}

// ─── Helper: parse "time=HH:MM:SS.ms" from FFmpeg stderr ─────

fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    let time_idx = line.find("time=")?;
    let time_str = &line[time_idx + 5..];
    let end = time_str.find(' ').unwrap_or(time_str.len());
    let hms = &time_str[..end];
    let parts: Vec<&str> = hms.split(':').collect();
    if parts.len() != 3 { return None; }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

// ─── Helper: preset mappings ──────────────────────────────────

fn quality_to_crf(quality: &str) -> u32 {
    match quality {
        "Highest" => 18,
        "Good"    => 23,
        "Balanced"=> 28,
        "Small"   => 35,
        _         => 28,
    }
}

fn quality_to_jpeg_q(quality: &str) -> u32 {
    match quality {
        "Highest" => 95,
        "Good"    => 82,
        "Balanced"=> 70,
        "Small"   => 55,
        _         => 75,
    }
}

fn resolution_to_scale(res: &str) -> Option<String> {
    match res {
        "4K"   => Some("scale=3840:2160:flags=lanczos".to_string()),
        "1080p"=> Some("scale=1920:1080:flags=lanczos".to_string()),
        "720p" => Some("scale=1280:720:flags=lanczos".to_string()),
        "480p" => Some("scale=854:480:flags=lanczos".to_string()),
        _      => None,
    }
}

// ─── Command: detect_gpu ─────────────────────────────────────

#[tauri::command]
async fn detect_gpu(app: AppHandle) -> GpuInfo {
    if let Some(ffmpeg) = find_ffmpeg(&app) {
        if let Ok(out) = create_command(&ffmpeg)
            .args(["-hide_banner", "-encoders"])
            .output()
            .await
        {
            let encoders = String::from_utf8_lossy(&out.stdout);

            if encoders.contains("h264_nvenc") {
                return GpuInfo {
                    gpu_type: "nvidia".into(),
                    label: "NVIDIA GPU (NVENC)".into(),
                    encoder: "h264_nvenc".into(),
                    available: true,
                };
            }
            if encoders.contains("h264_qsv") {
                return GpuInfo {
                    gpu_type: "intel".into(),
                    label: "Intel Quick Sync".into(),
                    encoder: "h264_qsv".into(),
                    available: true,
                };
            }
            if encoders.contains("h264_amf") {
                return GpuInfo {
                    gpu_type: "amd".into(),
                    label: "AMD AMF".into(),
                    encoder: "h264_amf".into(),
                    available: true,
                };
            }
        }
    }

    GpuInfo {
        gpu_type: "cpu".into(),
        label: "Software (libx264)".into(),
        encoder: "libx264".into(),
        available: true,
    }
}

// ─── Command: compress_file ───────────────────────────────────

#[tauri::command]
async fn compress_file(
    app: AppHandle,
    request: CompressRequest,
) -> Result<(), String> {
    let id = request.id.clone();

    let _ = app.emit("compress_progress", ProgressEvent {
        id: id.clone(),
        progress: 0.0,
        status: "compressing".into(),
        compressed_size: None,
        output_path: None,
        error_msg: None,
    });

    let result = do_compress(&app, &request).await;

    match result {
        Ok((compressed_size, output_path)) => {
            let _ = app.emit("compress_progress", ProgressEvent {
                id: id.clone(),
                progress: 100.0,
                status: "done".into(),
                compressed_size: Some(compressed_size),
                output_path: Some(output_path),
                error_msg: None,
            });
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("compress_progress", ProgressEvent {
                id: id.clone(),
                progress: 0.0,
                status: "error".into(),
                compressed_size: None,
                output_path: None,
                error_msg: Some(e.clone()),
            });
            Err(e)
        }
    }
}

async fn do_compress(app: &AppHandle, req: &CompressRequest) -> Result<(u64, String), String> {
    match req.file_type.as_str() {
        "video" => compress_video(app, req).await,
        "gif"   => compress_gif(app, req).await,
        "image" => compress_image(app, req).await,
        "pdf"   => compress_pdf(app, req).await,
        _       => Err(format!("Unsupported file type: {}", req.file_type)),
    }
}

// ── Video compression ─────────────────────────────────────────

async fn compress_video(app: &AppHandle, req: &CompressRequest) -> Result<(u64, String), String> {
    let ffmpeg = find_ffmpeg(app).ok_or("FFmpeg not found in resources or PATH. Please install FFmpeg.")?;
    let duration = get_video_duration_secs(app, &req.input_path).await;

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(), req.input_path.clone(),
        "-progress".into(), "pipe:2".into(),
    ];

    let encoder = if req.encoder.is_empty() { "libx264" } else { &req.encoder };
    args.push("-c:v".into());
    args.push(encoder.into());

    let crf = if req.crf_value == 0 { quality_to_crf("Balanced") } else { req.crf_value };
    args.push("-crf".into());
    args.push(crf.to_string());

    if encoder == "libx264" || encoder == "libx265" {
        args.push("-preset".into());
        args.push("fast".into());
    }

    if let Some(scale) = resolution_to_scale(&req.resolution) {
        args.push("-vf".into());
        args.push(scale);
    }

    if req.remove_audio {
        args.push("-an".into());
    } else {
        args.push("-c:a".into());
        args.push("aac".into());
        args.push("-b:a".into());
        args.push("128k".into());
    }

    let ext = match req.video_format.as_str() {
        "MOV"  => "mov",
        "MKV"  => "mkv",
        "WebM" => "webm",
        _      => "mp4",
    };

    let out_path = derive_output_path(&req.input_path, &req.output_path, ext);
    args.push(out_path.to_string_lossy().into_owned());

    run_ffmpeg_with_progress(app, &req.id, ffmpeg, args, duration).await?;

    let size = std::fs::metadata(&out_path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())?;

    Ok((size, out_path.to_string_lossy().into_owned()))
}

// ── GIF compression ───────────────────────────────────────────

async fn compress_gif(app: &AppHandle, req: &CompressRequest) -> Result<(u64, String), String> {
    let ffmpeg = find_ffmpeg(app).ok_or("FFmpeg not found. Please install FFmpeg.")?;
    let duration = get_video_duration_secs(app, &req.input_path).await;

    let out_path = derive_output_path(&req.input_path, &req.output_path, "gif");
    let out_str = out_path.to_string_lossy().into_owned();
    let palette_path = format!("{}.palette.png", out_str);

    let pass1_args = vec![
        "-y".into(),
        "-i".into(), req.input_path.clone(),
        "-vf".into(), "fps=10,scale=480:-1:flags=lanczos,palettegen".into(),
        palette_path.clone(),
    ];
    run_ffmpeg_with_progress(app, &req.id, ffmpeg.clone(), pass1_args, None).await?;

    let pass2_args = vec![
        "-y".into(),
        "-i".into(), req.input_path.clone(),
        "-i".into(), palette_path.clone(),
        "-filter_complex".into(),
        "fps=10,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse".into(),
        out_str.clone(),
    ];
    run_ffmpeg_with_progress(app, &req.id, ffmpeg, pass2_args, duration).await?;

    let _ = std::fs::remove_file(&palette_path);

    let size = std::fs::metadata(&out_path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())?;

    Ok((size, out_path.to_string_lossy().into_owned()))
}

// ── Image compression ─────────────────────────────────────────

async fn compress_image(app: &AppHandle, req: &CompressRequest) -> Result<(u64, String), String> {
    let ffmpeg = find_ffmpeg(app).ok_or("FFmpeg not found. Please install FFmpeg.")?;

    let ext = match req.image_format.as_str() {
        "PNG"  => "png",
        "WebP" => "webp",
        _      => "jpg",
    };
    let out_path = derive_output_path(&req.input_path, &req.output_path, ext);
    let out_str  = out_path.to_string_lossy().into_owned();
    let q = quality_to_jpeg_q(&req.image_quality);

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(), req.input_path.clone(),
    ];

    match req.image_format.as_str() {
        "WebP" => {
            args.push("-c:v".into());
            args.push("libwebp".into());
            args.push("-quality".into());
            args.push(q.to_string());
        }
        "PNG" => {
            args.push("-compression_level".into());
            args.push("9".into());
        }
        _ => {
            args.push("-q:v".into());
            args.push(format!("{}", (100 - q) / 3 + 2));
        }
    }

    args.push(out_str);

    let _ = app.emit("compress_progress", ProgressEvent {
        id: req.id.clone(),
        progress: 50.0,
        status: "compressing".into(),
        compressed_size: None,
        output_path: None,
        error_msg: None,
    });

    run_ffmpeg_with_progress(app, &req.id, ffmpeg, args, None).await?;

    let size = std::fs::metadata(&out_path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())?;

    Ok((size, out_path.to_string_lossy().into_owned()))
}

// ── PDF compression ───────────────────────────────────────────

async fn compress_pdf(_app: &AppHandle, req: &CompressRequest) -> Result<(u64, String), String> {
    let gs = which::which("gswin64c")
        .or_else(|_| which::which("gswin32c"))
        .or_else(|_| which::which("gs"))
        .map_err(|_| "Ghostscript (gs) not found in PATH. Please install Ghostscript.".to_string())?;

    let quality_setting = match req.pdf_quality.as_str() {
        "Highest" => "/printer",
        "Good"    => "/ebook",
        "Balanced"=> "/ebook",
        "Small"   => "/screen",
        _         => "/ebook",
    };

    let out_path = derive_output_path(&req.input_path, &req.output_path, "pdf");

    let status = create_command(gs)
        .args([
            "-dBATCH",
            "-dNOPAUSE",
            "-dSAFER",
            "-sDEVICE=pdfwrite",
            &format!("-dPDFSETTINGS={}", quality_setting),
            &format!("-sOutputFile={}", out_path.to_string_lossy()),
            &req.input_path,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if !status.success() {
        return Err("Ghostscript failed to compress PDF".into());
    }

    let size = std::fs::metadata(&out_path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())?;

    Ok((size, out_path.to_string_lossy().into_owned()))
}

// ─── FFmpeg runner with progress events ──────────────────────

async fn run_ffmpeg_with_progress(
    app: &AppHandle,
    id: &str,
    ffmpeg: PathBuf,
    args: Vec<String>,
    duration: Option<f64>,
) -> Result<(), String> {
    let mut child = create_command(ffmpeg)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;

    let stderr = child.stderr.take().unwrap();
    let mut reader = BufReader::new(stderr).lines();

    while let Ok(Some(line)) = reader.next_line().await {
        if let Some(elapsed) = parse_ffmpeg_time(&line) {
            let progress = if let Some(dur) = duration {
                ((elapsed / dur) * 100.0).min(99.0)
            } else {
                50.0
            };
            let _ = app.emit("compress_progress", ProgressEvent {
                id: id.to_string(),
                progress,
                status: "compressing".into(),
                compressed_size: None,
                output_path: None,
                error_msg: None,
            });
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("FFmpeg exited with code {:?}", status.code()));
    }
    Ok(())
}

// ─── Helper: derive output path ───────────────────────────────

fn derive_output_path(input: &str, output_dir: &str, ext: &str) -> PathBuf {
    let input_path = Path::new(input);
    let stem = input_path.file_stem().unwrap_or_default();
    let file_name = format!("{}_compressed.{}", stem.to_string_lossy(), ext);

    if output_dir.is_empty() || output_dir == "Same as input" {
        input_path.parent().unwrap_or(Path::new(".")).join(file_name)
    } else {
        Path::new(output_dir).join(file_name)
    }
}

// ─── Command: pick_folder ─────────────────────────────────────

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog()
        .file()
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });

    rx.await
        .ok()
        .flatten()
        .map(|p| p.to_string())
}

// ─── Command: reveal_in_explorer ─────────────────────────────

#[tauri::command]
async fn reveal_in_explorer(path: String) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new("explorer");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    
    cmd.args(["/select,", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Command: get_file_size ───────────────────────────────────

#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

// ─── App entry ────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            detect_gpu,
            compress_file,
            pick_folder,
            reveal_in_explorer,
            get_file_size,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
