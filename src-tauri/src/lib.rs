// ═══════════════════════════════════════════════════════════════
// src-tauri/src/lib.rs
// xCompress — Tauri backend commands with hidden console window creation flags
// ═══════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const CANCELLED_ERROR: &str = "Compression stopped.";

#[derive(Default)]
struct CompressionState {
    active_pids: Mutex<HashMap<String, u32>>,
    cancelled_ids: Mutex<HashSet<String>>,
}

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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueuedFileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub file_type: String,
    pub extension: String,
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

fn find_ghostscript() -> Option<PathBuf> {
    which::which("gswin64c")
        .or_else(|_| which::which("gswin32c"))
        .or_else(|_| which::which("gs"))
        .ok()
}

fn find_tool(candidates: &[&str]) -> Option<PathBuf> {
    candidates.iter().find_map(|candidate| which::which(candidate).ok())
}

fn preview_cache_key(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    if let Ok(metadata) = std::fs::metadata(path) {
        metadata.len().hash(&mut hasher);
        if let Ok(modified) = metadata.modified() {
            modified.hash(&mut hasher);
        }
    }
    format!("{:016x}", hasher.finish())
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

async fn probe_media_info(app: &AppHandle, input: &str) -> Option<MediaInfo> {
    let ffprobe = find_ffprobe(app)?;
    let out = create_command(ffprobe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration:format=duration",
            "-of", "json",
            input,
        ])
        .output()
        .await
        .ok()?;

    if !out.status.success() {
        return None;
    }

    let value: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let stream = value.get("streams")?.as_array()?.first();
    let width = stream
        .and_then(|s| s.get("width"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let height = stream
        .and_then(|s| s.get("height"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let duration = stream
        .and_then(|s| s.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            value
                .get("format")
                .and_then(|f| f.get("duration"))
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<f64>().ok())
        });

    Some(MediaInfo { width, height, duration })
}

// ─── Helper: parse "time=HH:MM:SS.ms" from FFmpeg stderr ─────

fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    if let Some(value) = line.strip_prefix("out_time_ms=") {
        let micros: f64 = value.trim().parse().ok()?;
        return Some(micros / 1_000_000.0);
    }
    if let Some(value) = line.strip_prefix("out_time=") {
        return parse_hms_time(value.trim());
    }

    let time_idx = line.find("time=")?;
    let time_str = &line[time_idx + 5..];
    let end = time_str.find(' ').unwrap_or(time_str.len());
    parse_hms_time(&time_str[..end])
}

fn parse_hms_time(hms: &str) -> Option<f64> {
    let parts: Vec<&str> = hms.split(':').collect();
    if parts.len() != 3 { return None; }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

// ─── Helper: preset mappings ──────────────────────────────────

fn quality_to_jpeg_q(quality: &str) -> u32 {
    match quality {
        "Highest" => 95,
        "Good"    => 82,
        "Balanced"=> 70,
        "Small"   => 55,
        _         => 75,
    }
}

fn jpeg_qscale_from_quality(quality: u32) -> u32 {
    ((100_u32.saturating_sub(quality.clamp(1, 100))) / 3 + 2).clamp(2, 31)
}

fn build_image_args(
    input: &str,
    output: &str,
    image_format: &str,
    quality: u32,
    dimensions: Option<(u32, u32)>,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), input.into()];

    match image_format {
        "WebP" => {
            args.extend([
                "-frames:v".into(), "1".into(),
                "-c:v".into(), "libwebp".into(),
                "-preset".into(), "picture".into(),
                "-quality".into(), quality.clamp(1, 100).to_string(),
                "-compression_level".into(), "6".into(),
            ]);
        }
        "PNG" => {
            args.extend([
                "-frames:v".into(), "1".into(),
                "-compression_level".into(), "9".into(),
                "-pred".into(), "mixed".into(),
            ]);
        }
        _ => {
            if let Some((width, height)) = dimensions {
                args.extend([
                    "-f".into(), "lavfi".into(),
                    "-i".into(), format!("color=c=white:s={}x{}", width, height),
                    "-filter_complex".into(),
                    "[0:v]format=rgba[fg];[1:v][fg]overlay=format=auto,format=yuvj420p".into(),
                ]);
            } else {
                args.extend(["-vf".into(), "format=yuvj420p".into()]);
            }
            args.extend([
                "-frames:v".into(), "1".into(),
                "-q:v".into(), jpeg_qscale_from_quality(quality).to_string(),
            ]);
        }
    }

    args.extend(["-map_metadata".into(), "-1".into(), output.into()]);
    args
}

fn preferred_image_tool(input_ext: &str, image_format: &str) -> &'static str {
    let is_wide_input = matches!(
        input_ext,
        "heic" | "heif" | "tif" | "tiff" | "bmp" | "dng" | "cr2" | "nef" | "arw" | "rw2" | "raf" | "orf"
    );
    match (is_wide_input, image_format) {
        (true, _) => "vips-or-magick",
        (_, "PNG") => "ffmpeg-plus-png-optimizers",
        (_, "WebP") => "ffmpeg-libwebp",
        _ => "ffmpeg-jpeg",
    }
}

fn output_extension_for_image_format(image_format: &str) -> &'static str {
    match image_format {
        "PNG" => "png",
        "WebP" => "webp",
        _ => "jpg",
    }
}

fn build_vips_args(input: &str, output: &str, image_format: &str, quality: u32) -> Vec<String> {
    let output_with_options = match image_format {
        "PNG" => format!("{}[compression=9,strip]", output),
        "WebP" => format!("{}[Q={},strip]", output, quality.clamp(1, 100)),
        _ => format!("{}[Q={},strip]", output, quality.clamp(1, 100)),
    };
    vec!["copy".into(), input.into(), output_with_options]
}

fn build_magick_args(input: &str, output: &str, image_format: &str, quality: u32) -> Vec<String> {
    let mut args = vec![input.into(), "-auto-orient".into(), "-strip".into()];
    if image_format == "JPEG" {
        args.extend(["-background".into(), "white".into(), "-alpha".into(), "remove".into(), "-alpha".into(), "off".into()]);
    }
    args.extend(["-quality".into(), quality.clamp(1, 100).to_string(), output.into()]);
    args
}

fn build_pngquant_args(input_output: &str, quality: u32) -> Vec<String> {
    let min_quality = quality.saturating_sub(18).clamp(1, 100);
    vec![
        "--force".into(),
        "--skip-if-larger".into(),
        "--quality".into(),
        format!("{}-{}", min_quality, quality.clamp(1, 100)),
        "--output".into(),
        input_output.into(),
        input_output.into(),
    ]
}

fn build_oxipng_args(input_output: &str) -> Vec<String> {
    vec!["-o".into(), "4".into(), "--strip".into(), "safe".into(), input_output.into()]
}

fn build_gifski_args(input: &str, output: &str, crf: u32) -> Vec<String> {
    let quality = match crf {
        0..=21 => 90,
        22..=24 => 82,
        25..=28 => 72,
        _ => 60,
    };
    vec![
        "--quality".into(),
        quality.to_string(),
        "--fps".into(),
        if crf >= 29 { "8".into() } else { "12".into() },
        "--output".into(),
        output.into(),
        input.into(),
    ]
}

fn build_mutool_pdf_args(input: &str, output: &str) -> Vec<String> {
    vec![
        "clean".into(),
        "-gggg".into(),
        "-d".into(),
        input.into(),
        output.into(),
    ]
}

fn gif_filter_for_crf(crf: u32) -> &'static str {
    match crf {
        0..=21 => "fps=15,scale=720:-1:flags=lanczos",
        22..=24 => "fps=12,scale=640:-1:flags=lanczos",
        25..=28 => "fps=10,scale=540:-1:flags=lanczos",
        _ => "fps=8,scale=420:-1:flags=lanczos",
    }
}

fn normalize_extension(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn file_type_from_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "mpg" | "mpeg" | "3gp" | "mts" | "m2ts" => Some("video"),
        "gif" => Some("gif"),
        "jpg" | "jpeg" | "png" | "webp" | "heic" | "heif" | "tif" | "tiff" | "bmp" | "dng" | "cr2" | "nef" | "arw" | "rw2" | "raf" | "orf" => Some("image"),
        "pdf" => Some("pdf"),
        _ => None,
    }
}

fn is_supported_media_path(path: &Path) -> bool {
    file_type_from_extension(&normalize_extension(path)).is_some()
}

fn queued_file_info(path: &Path) -> Option<QueuedFileInfo> {
    let ext = normalize_extension(path);
    let file_type = file_type_from_extension(&ext)?;
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    Some(QueuedFileInfo {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        size: metadata.len(),
        file_type: file_type.into(),
        extension: ext,
    })
}

fn collect_supported_paths(paths: Vec<String>) -> Vec<QueuedFileInfo> {
    let mut results = Vec::new();
    let mut queue: VecDeque<PathBuf> = paths.into_iter().map(PathBuf::from).collect();

    while let Some(path) = queue.pop_front() {
        if path.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&path) {
                for entry in entries.flatten() {
                    queue.push_back(entry.path());
                }
            }
        } else if is_supported_media_path(&path) {
            if let Some(info) = queued_file_info(&path) {
                results.push(info);
            }
        }
    }

    results.sort_by(|a, b| a.path.cmp(&b.path));
    results
}

fn resolution_to_scale(res: &str) -> Option<String> {
    match res {
        "4K"   => Some("scale=3840:2160:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1".to_string()),
        "1080p"=> Some("scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1".to_string()),
        "720p" => Some("scale=1280:720:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1".to_string()),
        "480p" => Some("scale=854:480:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1".to_string()),
        _      => None,
    }
}

fn encoder_kind(encoder: &str) -> &'static str {
    if encoder.contains("265") || encoder.contains("hevc") {
        "h265"
    } else if encoder.contains("264") {
        "h264"
    } else if encoder.contains("svtav1") || encoder.contains("av1") {
        "av1"
    } else {
        "unknown"
    }
}

fn is_hardware_encoder(encoder: &str) -> bool {
    encoder.ends_with("_nvenc") || encoder.ends_with("_qsv") || encoder.ends_with("_amf")
}

fn crf_for_encoder(encoder: &str, requested: u32) -> u32 {
    let fallback = match encoder_kind(encoder) {
        "h265" => 24,
        "h264" => 23,
        "av1" => 34,
        _ => 24,
    };
    if requested == 0 { fallback } else { requested }
}

fn nvenc_cq_from_crf(crf: u32) -> u32 {
    crf.clamp(18, 34)
}

fn target_bitrate_kbps(target_kb: u64, duration: Option<f64>, audio_kbps: u32) -> Option<u32> {
    let duration = duration?;
    if target_kb == 0 || duration <= 0.0 {
        return None;
    }
    let total_kbps = ((target_kb as f64 * 8.192) / duration).round() as i64;
    Some((total_kbps - audio_kbps as i64).max(250) as u32)
}

fn recommended_h264_hw_bitrate_kbps(resolution: &str, crf: u32) -> u32 {
    let base_4k = match crf {
        0..=20 => 35_000,
        21..=23 => 28_000,
        24..=26 => 20_000,
        27..=29 => 12_000,
        _ => 9_000,
    };

    match resolution {
        "1080p" => (base_4k as f64 * 0.35) as u32,
        "720p" => (base_4k as f64 * 0.18) as u32,
        "480p" => (base_4k as f64 * 0.10) as u32,
        _ => base_4k,
    }
}

fn push_bitrate_args(args: &mut Vec<String>, bitrate_kbps: u32) {
    args.push("-b:v".into());
    args.push(format!("{}k", bitrate_kbps));
    args.push("-maxrate".into());
    args.push(format!("{}k", ((bitrate_kbps as f64) * 1.4).round() as u32));
    args.push("-bufsize".into());
    args.push(format!("{}k", bitrate_kbps * 2));
}

fn build_video_codec_args(
    encoder: &str,
    encoder_choice: &str,
    req: &CompressRequest,
    duration: Option<f64>,
) -> Vec<String> {
    let mut args = vec!["-c:v".into(), encoder.into()];
    let crf = crf_for_encoder(encoder, req.crf_value);
    let target_kbps = if req.video_quality == "File size" {
        target_bitrate_kbps(req.target_kb, duration, if req.remove_audio { 0 } else { 128 })
    } else {
        None
    };

    match encoder {
        "libx265" => {
            args.push("-preset".into());
            let preset = match encoder_choice {
                "best" => "medium",
                "auto" => "ultrafast",
                _ => "fast",
            };
            args.push(preset.into());
            if let Some(kbps) = target_kbps {
                push_bitrate_args(&mut args, kbps);
            } else {
                args.push("-crf".into());
                args.push(crf.to_string());
            }
            args.push("-tag:v".into());
            args.push("hvc1".into());
        }
        "libx264" => {
            args.push("-preset".into());
            args.push("fast".into());
            if let Some(kbps) = target_kbps {
                push_bitrate_args(&mut args, kbps);
            } else {
                args.push("-crf".into());
                args.push(crf.to_string());
            }
        }
        "hevc_nvenc" => {
            args.extend(["-preset", "p6", "-tune", "hq", "-rc", "vbr"].iter().map(|s| s.to_string()));
            if let Some(kbps) = target_kbps {
                push_bitrate_args(&mut args, kbps);
            } else {
                args.push("-cq".into());
                args.push(nvenc_cq_from_crf(crf).to_string());
                args.push("-b:v".into());
                args.push("0".into());
            }
            args.extend([
                "-spatial_aq", "1",
                "-temporal_aq", "1",
                "-multipass", "qres",
                "-rc-lookahead", "32",
                "-tag:v", "hvc1",
            ].iter().map(|s| s.to_string()));
        }
        "h264_nvenc" => {
            args.extend(["-preset", "p6", "-tune", "hq", "-rc", "vbr"].iter().map(|s| s.to_string()));
            let kbps = target_kbps.unwrap_or_else(|| recommended_h264_hw_bitrate_kbps(&req.resolution, crf));
            push_bitrate_args(&mut args, kbps);
            args.extend([
                "-spatial_aq", "1",
                "-temporal_aq", "1",
                "-multipass", "qres",
                "-rc-lookahead", "32",
            ].iter().map(|s| s.to_string()));
        }
        "hevc_amf" | "h264_amf" => {
            args.extend(["-usage", "high_quality", "-quality", "quality"].iter().map(|s| s.to_string()));
            if let Some(kbps) = target_kbps {
                args.extend(["-rc", "vbr_peak"].iter().map(|s| s.to_string()));
                push_bitrate_args(&mut args, kbps);
            } else {
                args.extend(["-rc", "qvbr", "-qvbr_quality_level"].iter().map(|s| s.to_string()));
                args.push(crf.clamp(18, 34).to_string());
            }
            if encoder == "hevc_amf" {
                args.push("-tag:v".into());
                args.push("hvc1".into());
            }
        }
        "hevc_qsv" | "h264_qsv" => {
            args.extend(["-preset", "slow"].iter().map(|s| s.to_string()));
            if let Some(kbps) = target_kbps {
                push_bitrate_args(&mut args, kbps);
            } else {
                args.push("-global_quality".into());
                args.push(crf.clamp(18, 34).to_string());
            }
            if encoder == "hevc_qsv" {
                args.push("-tag:v".into());
                args.push("hvc1".into());
            }
        }
        "libsvtav1" => {
            args.extend(["-preset", "8", "-crf"].iter().map(|s| s.to_string()));
            args.push(crf.clamp(24, 45).to_string());
        }
        _ => {
            args.push("-crf".into());
            args.push(crf.to_string());
        }
    }

    args.push("-pix_fmt".into());
    args.push("yuv420p".into());
    args
}

fn build_webm_codec_args(req: &CompressRequest) -> Vec<String> {
    let crf = crf_for_encoder("libvpx-vp9", req.crf_value).clamp(18, 38);
    vec![
        "-c:v".into(), "libvpx-vp9".into(),
        "-deadline".into(), "good".into(),
        "-cpu-used".into(), "4".into(),
        "-crf".into(), crf.to_string(),
        "-b:v".into(), "0".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]
}

fn hardware_type_for_encoder(encoder: &str) -> &'static str {
    if encoder.ends_with("_nvenc") {
        "nvidia"
    } else if encoder.ends_with("_qsv") {
        "intel"
    } else if encoder.ends_with("_amf") {
        "amd"
    } else {
        "cpu"
    }
}

fn label_for_encoder(encoder: &str) -> String {
    match encoder {
        "hevc_nvenc" => "NVIDIA GPU (HEVC NVENC)".into(),
        "h264_nvenc" => "NVIDIA GPU (H.264 NVENC)".into(),
        "hevc_qsv" => "Intel Quick Sync (HEVC)".into(),
        "h264_qsv" => "Intel Quick Sync (H.264)".into(),
        "hevc_amf" => "AMD AMF (HEVC)".into(),
        "h264_amf" => "AMD AMF (H.264)".into(),
        "libx265" => "Software (H.265/x265)".into(),
        "libx264" => "Software (H.264/x264)".into(),
        _ => format!("Encoder {}", encoder),
    }
}

fn hardware_encoder_candidates(prefer_h265: bool) -> Vec<&'static str> {
    if prefer_h265 {
        vec!["hevc_nvenc", "hevc_qsv", "hevc_amf", "h264_nvenc", "h264_qsv", "h264_amf"]
    } else {
        vec!["h264_nvenc", "h264_qsv", "h264_amf", "hevc_nvenc", "hevc_qsv", "hevc_amf"]
    }
}

async fn encoder_exists(app: &AppHandle, encoder: &str) -> bool {
    let Some(ffmpeg) = find_ffmpeg(app) else { return false; };
    let Ok(out) = create_command(&ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .await
    else {
        return false;
    };

    String::from_utf8_lossy(&out.stdout).contains(encoder)
}

async fn probe_encoder(app: &AppHandle, encoder: &str) -> bool {
    if !encoder_exists(app, encoder).await {
        return false;
    }

    if !is_hardware_encoder(encoder) {
        return true;
    }

    let Some(ffmpeg) = find_ffmpeg(app) else { return false; };
    let mut args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-f".to_string(),
        "lavfi".to_string(),
        "-i".to_string(),
        "color=c=black:s=128x72:r=1:d=0.1".to_string(),
        "-frames:v".to_string(),
        "1".to_string(),
    ];

    let probe_req = CompressRequest {
        id: "probe".into(),
        input_path: String::new(),
        output_path: String::new(),
        file_type: "video".into(),
        video_format: "MP4".into(),
        video_quality: "CRF".into(),
        crf_value: 28,
        target_kb: 0,
        resolution: "Same as input".into(),
        remove_audio: true,
        image_quality: "Balanced".into(),
        image_format: "JPEG".into(),
        pdf_quality: "Balanced".into(),
        encoder: encoder.into(),
    };
    args.extend(build_video_codec_args(encoder, encoder, &probe_req, Some(0.1)));
    args.extend(["-f".into(), "null".into(), "-".into()]);

    match tokio::time::timeout(
        Duration::from_secs(5),
        create_command(ffmpeg)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
    )
    .await
    {
        Ok(Ok(status)) => status.success(),
        _ => false,
    }
}

async fn first_working_encoder(app: &AppHandle, candidates: &[&str]) -> Option<String> {
    for encoder in candidates {
        if probe_encoder(app, encoder).await {
            return Some((*encoder).to_string());
        }
    }
    None
}

async fn resolve_video_encoder(app: &AppHandle, choice: &str) -> String {
    match choice {
        "best" | "h265Cpu" => {
            if probe_encoder(app, "libx265").await { "libx265".into() } else { "libx264".into() }
        }
        "h264Cpu" => "libx264".into(),
        "h265Gpu" => first_working_encoder(app, &["hevc_nvenc", "hevc_qsv", "hevc_amf"])
            .await
            .unwrap_or_else(|| "libx265".into()),
        "h264Gpu" | "fast" => first_working_encoder(app, &hardware_encoder_candidates(false))
            .await
            .unwrap_or_else(|| "libx264".into()),
        "auto" | "" => first_working_encoder(app, &hardware_encoder_candidates(true))
            .await
            .unwrap_or_else(|| {
                if which::which("ffmpeg").is_ok() { "libx265".into() } else { "libx264".into() }
            }),
        concrete => {
            if probe_encoder(app, concrete).await {
                concrete.into()
            } else {
                first_working_encoder(app, &hardware_encoder_candidates(true))
                    .await
                    .unwrap_or_else(|| "libx265".into())
            }
        }
    }
}

// ─── Command: detect_gpu ─────────────────────────────────────

#[tauri::command]
async fn detect_gpu(app: AppHandle) -> GpuInfo {
    if let Some(encoder) = first_working_encoder(&app, &hardware_encoder_candidates(true)).await {
        return GpuInfo {
            gpu_type: hardware_type_for_encoder(&encoder).into(),
            label: label_for_encoder(&encoder),
            encoder,
            available: true,
        };
    }

    GpuInfo {
        gpu_type: "cpu".into(),
        label: "Software (H.265/x265)".into(),
        encoder: "libx265".into(),
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
    {
        let state = app.state::<CompressionState>();
        state.cancelled_ids.lock().await.remove(&id);
    }

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
            let status = if e == CANCELLED_ERROR { "cancelled" } else { "error" };
            let _ = app.emit("compress_progress", ProgressEvent {
                id: id.clone(),
                progress: 0.0,
                status: status.into(),
                compressed_size: None,
                output_path: None,
                error_msg: Some(e.clone()),
            });
            Err(e)
        }
    }
}

#[tauri::command]
async fn cancel_compression(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let state = app.state::<CompressionState>();
    let active = state.active_pids.lock().await;
    let ids_to_cancel: Vec<String> = if ids.is_empty() {
        active.keys().cloned().collect()
    } else {
        ids
    };

    let mut pids_to_kill = Vec::new();
    for id in &ids_to_cancel {
        if let Some(pid) = active.get(id) {
            pids_to_kill.push((*pid, id.clone()));
        }
    }
    drop(active);

    {
        let mut cancelled = state.cancelled_ids.lock().await;
        for (_, id) in &pids_to_kill {
            cancelled.insert(id.clone());
        }
    }

    for (pid, _) in pids_to_kill {
        kill_process_tree(pid).await?;
    }

    Ok(())
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

async fn kill_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = create_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = create_command("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }

    Ok(())
}

// ── Video compression ─────────────────────────────────────────

async fn compress_video(app: &AppHandle, req: &CompressRequest) -> Result<(u64, String), String> {
    let ffmpeg = find_ffmpeg(app).ok_or("FFmpeg not found in resources or PATH. Please install FFmpeg.")?;
    let duration = get_video_duration_secs(app, &req.input_path).await;

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(), req.input_path.clone(),
        "-map".into(), "0:v:0".into(),
        "-map".into(), "0:a?".into(),
        "-progress".into(), "pipe:2".into(),
        "-nostats".into(),
    ];

    let encoder_choice = if req.encoder.is_empty() { "auto" } else { req.encoder.as_str() };
    let encoder = resolve_video_encoder(app, encoder_choice).await;

    if req.video_format == "WebM" {
        args.extend(build_webm_codec_args(req));
    } else {
        args.extend(build_video_codec_args(&encoder, encoder_choice, req, duration));
    }

    if let Some(scale) = resolution_to_scale(&req.resolution) {
        args.push("-vf".into());
        args.push(scale);
    }

    if req.remove_audio {
        args.push("-an".into());
    } else {
        args.push("-c:a".into());
        if req.video_format == "WebM" {
            args.push("libopus".into());
            args.push("-b:a".into());
            args.push("96k".into());
        } else {
            args.push("aac".into());
            args.push("-b:a".into());
            args.push("128k".into());
        }
    }

    let ext = match req.video_format.as_str() {
        "MOV"  => "mov",
        "MKV"  => "mkv",
        "WebM" => "webm",
        _      => "mp4",
    };

    let out_path = derive_output_path_with_tag(
        &req.input_path,
        &req.output_path,
        ext,
        video_output_name_tag(req),
    );
    if req.video_format == "MP4" || req.video_format == "MOV" {
        args.push("-movflags".into());
        args.push("+faststart".into());
    }
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

    if let Some(gifski) = find_tool(&["gifski"]) {
        let args = build_gifski_args(&req.input_path, &out_str, req.crf_value);
        let status = create_command(gifski)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?;
        if status.success() {
            let size = std::fs::metadata(&out_path)
                .map(|m| m.len())
                .map_err(|e| e.to_string())?;
            return Ok((size, out_path.to_string_lossy().into_owned()));
        }
    }

    let palette_path = format!("{}.palette.png", out_str);
    let gif_filter = gif_filter_for_crf(req.crf_value);

    let pass1_args = vec![
        "-y".into(),
        "-i".into(), req.input_path.clone(),
        "-vf".into(), format!("{},palettegen=stats_mode=diff", gif_filter),
        palette_path.clone(),
    ];
    run_ffmpeg_with_progress(app, &req.id, ffmpeg.clone(), pass1_args, None).await?;

    let pass2_args = vec![
        "-y".into(),
        "-i".into(), req.input_path.clone(),
        "-i".into(), palette_path.clone(),
        "-filter_complex".into(),
        format!("{}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle", gif_filter),
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

    let ext = output_extension_for_image_format(&req.image_format);
    let out_path = derive_output_path(&req.input_path, &req.output_path, ext);
    let out_str  = out_path.to_string_lossy().into_owned();
    let q = quality_to_jpeg_q(&req.image_quality);
    let input_ext = normalize_extension(Path::new(&req.input_path));

    if preferred_image_tool(&input_ext, &req.image_format) == "vips-or-magick" {
        if let Some(vips) = find_tool(&["vips"]) {
            let status = create_command(vips)
                .args(build_vips_args(&req.input_path, &out_str, &req.image_format, q))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map_err(|e| e.to_string())?;
            if status.success() {
                let size = std::fs::metadata(&out_path)
                    .map(|m| m.len())
                    .map_err(|e| e.to_string())?;
                return Ok((size, out_path.to_string_lossy().into_owned()));
            }
        }

        if let Some(magick) = find_tool(&["magick"]) {
            let status = create_command(magick)
                .args(build_magick_args(&req.input_path, &out_str, &req.image_format, q))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map_err(|e| e.to_string())?;
            if status.success() {
                let size = std::fs::metadata(&out_path)
                    .map(|m| m.len())
                    .map_err(|e| e.to_string())?;
                return Ok((size, out_path.to_string_lossy().into_owned()));
            }
        }
    }

    let dimensions = probe_media_info(app, &req.input_path)
        .await
        .and_then(|info| info.width.zip(info.height));
    let args = build_image_args(&req.input_path, &out_str, &req.image_format, q, dimensions);

    let _ = app.emit("compress_progress", ProgressEvent {
        id: req.id.clone(),
        progress: 50.0,
        status: "compressing".into(),
        compressed_size: None,
        output_path: None,
        error_msg: None,
    });

    run_ffmpeg_with_progress(app, &req.id, ffmpeg, args, None).await?;

    if req.image_format == "PNG" {
        if let Some(pngquant) = find_tool(&["pngquant"]) {
            let _ = create_command(pngquant)
                .args(build_pngquant_args(&out_str, q))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
        }
        if let Some(oxipng) = find_tool(&["oxipng"]) {
            let _ = create_command(oxipng)
                .args(build_oxipng_args(&out_str))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
        }
    }

    let size = std::fs::metadata(&out_path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())?;

    Ok((size, out_path.to_string_lossy().into_owned()))
}

// ── PDF compression ───────────────────────────────────────────

async fn compress_pdf(_app: &AppHandle, req: &CompressRequest) -> Result<(u64, String), String> {
    let quality_setting = match req.pdf_quality.as_str() {
        "Highest" => "/printer",
        "Good"    => "/ebook",
        "Balanced"=> "/ebook",
        "Small"   => "/screen",
        _         => "/ebook",
    };

    let out_path = derive_output_path(&req.input_path, &req.output_path, "pdf");

    let status = if let Some(gs) = find_ghostscript() {
        create_command(gs)
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
            .map_err(|e| e.to_string())?
    } else if let Some(mutool) = find_tool(&["mutool"]) {
        create_command(mutool)
            .args(build_mutool_pdf_args(&req.input_path, &out_path.to_string_lossy()))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?
    } else {
        return Err("PDF compression requires Ghostscript or mutool. Install one of them and try again.".into());
    };

    if !status.success() {
        return Err("Ghostscript failed to compress this PDF. Try a less aggressive PDF quality preset or check whether the file is encrypted/corrupt.".into());
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

    let pid = child.id();
    if let Some(pid) = pid {
        let state = app.state::<CompressionState>();
        state.active_pids.lock().await.insert(id.to_string(), pid);
    }

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
    {
        let state = app.state::<CompressionState>();
        state.active_pids.lock().await.remove(id);
        if state.cancelled_ids.lock().await.remove(id) {
            return Err(CANCELLED_ERROR.into());
        }
    }

    if !status.success() {
        return Err(format!("FFmpeg exited with code {:?}", status.code()));
    }
    Ok(())
}

// ─── Helper: derive output path ───────────────────────────────

fn derive_output_path(input: &str, output_dir: &str, ext: &str) -> PathBuf {
    derive_output_path_with_tag(input, output_dir, ext, None)
}

fn video_output_name_tag(req: &CompressRequest) -> Option<String> {
    if req.resolution == "Same as input" {
        return None;
    }

    Some(
        req.resolution
            .to_lowercase()
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .collect::<String>()
    )
}

fn derive_output_path_with_tag(input: &str, output_dir: &str, ext: &str, tag: Option<String>) -> PathBuf {
    let input_path = Path::new(input);
    let stem = input_path.file_stem().unwrap_or_default();
    let file_name = if let Some(tag) = tag.filter(|value| !value.is_empty()) {
        format!("{}_{}_compressed.{}", stem.to_string_lossy(), tag, ext)
    } else {
        format!("{}_compressed.{}", stem.to_string_lossy(), ext)
    };

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

// ─── Command: expand_paths ────────────────────────────────────

#[tauri::command]
fn expand_paths(paths: Vec<String>) -> Vec<QueuedFileInfo> {
    collect_supported_paths(paths)
}

// ─── Command: get_media_info ──────────────────────────────────

#[tauri::command]
async fn get_media_info(app: AppHandle, path: String) -> Result<MediaInfo, String> {
    probe_media_info(&app, &path)
        .await
        .ok_or_else(|| "Unable to read media dimensions with FFprobe.".to_string())
}

#[tauri::command]
async fn prepare_video_preview(app: AppHandle, path: String) -> Result<String, String> {
    let ffmpeg = find_ffmpeg(&app).ok_or("FFmpeg not found. Cannot build video preview proxy.")?;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("video-previews");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let preview_path = cache_dir.join(format!("{}.mp4", preview_cache_key(&path)));
    if preview_path.exists() && std::fs::metadata(&preview_path).map(|m| m.len()).unwrap_or(0) > 0 {
        return Ok(preview_path.to_string_lossy().into_owned());
    }

    let temp_path = preview_path.with_extension("tmp.mp4");
    let status = create_command(ffmpeg)
        .args([
            "-y",
            "-i",
            &path,
            "-map",
            "0:v:0",
            "-t",
            "20",
            "-an",
            "-vf",
            "scale=1280:720:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "26",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            &temp_path.to_string_lossy(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if !status.success() {
        let _ = std::fs::remove_file(&temp_path);
        return Err("Cannot build a playable video preview for this file.".into());
    }

    std::fs::rename(&temp_path, &preview_path).map_err(|e| e.to_string())?;
    Ok(preview_path.to_string_lossy().into_owned())
}

// ─── Command: has_ghostscript ─────────────────────────────────

#[tauri::command]
fn has_ghostscript() -> bool {
    find_ghostscript().is_some()
}

// ─── App entry ────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CompressionState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            detect_gpu,
            compress_file,
            cancel_compression,
            pick_folder,
            reveal_in_explorer,
            get_file_size,
            expand_paths,
            get_media_info,
            prepare_video_preview,
            has_ghostscript,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video_req(encoder: &str, quality: &str, crf: u32, target_kb: u64) -> CompressRequest {
        CompressRequest {
            id: "test".into(),
            input_path: "input.mp4".into(),
            output_path: String::new(),
            file_type: "video".into(),
            video_format: "MP4".into(),
            video_quality: quality.into(),
            crf_value: crf,
            target_kb,
            resolution: "Same as input".into(),
            remove_audio: false,
            image_quality: "Balanced".into(),
            image_format: "JPEG".into(),
            pdf_quality: "Balanced".into(),
            encoder: encoder.into(),
        }
    }

    #[test]
    fn parses_ffmpeg_progress_key_value_time() {
        assert_eq!(parse_ffmpeg_time("out_time_ms=5000000"), Some(5.0));
        assert_eq!(parse_ffmpeg_time("out_time=00:01:02.500000"), Some(62.5));
    }

    #[test]
    fn x265_quality_args_use_crf_and_hvc1_tag() {
        let req = video_req("best", "CRF", 24, 0);
        let args = build_video_codec_args("libx265", "best", &req, Some(10.0));

        assert!(args.windows(2).any(|w| w == ["-c:v", "libx265"]));
        assert!(args.windows(2).any(|w| w == ["-preset", "medium"]));
        assert!(args.windows(2).any(|w| w == ["-crf", "24"]));
        assert!(args.windows(2).any(|w| w == ["-tag:v", "hvc1"]));
    }

    #[test]
    fn h264_nvenc_quality_args_use_bitrate_not_cq() {
        let req = video_req("h264Gpu", "CRF", 24, 0);
        let args = build_video_codec_args("h264_nvenc", "h264Gpu", &req, Some(10.0));

        assert!(args.windows(2).any(|w| w == ["-c:v", "h264_nvenc"]));
        assert!(args.windows(2).any(|w| w == ["-b:v", "20000k"]));
        assert!(!args.iter().any(|arg| arg == "-cq"));
    }

    #[test]
    fn target_size_mode_computes_video_bitrate_after_audio_budget() {
        let req = video_req("h265Cpu", "File size", 24, 25 * 1024);
        let args = build_video_codec_args("libx265", "h265Cpu", &req, Some(10.0));

        assert!(args.windows(2).any(|w| w == ["-b:v", "20844k"]));
        assert!(args.windows(2).any(|w| w == ["-maxrate", "29182k"]));
        assert!(!args.iter().any(|arg| arg == "-crf"));
    }

    #[test]
    fn auto_x265_uses_ultrafast_cpu_fallback_for_speed() {
        let req = video_req("auto", "CRF", 24, 0);
        let args = build_video_codec_args("libx265", "auto", &req, Some(10.0));

        assert!(args.windows(2).any(|w| w == ["-preset", "ultrafast"]));
        assert!(args.windows(2).any(|w| w == ["-crf", "24"]));
    }

    #[test]
    fn h264_nvenc_tiny_quality_uses_more_aggressive_bitrate_cap() {
        let req = video_req("h264Gpu", "CRF", 31, 0);
        let args = build_video_codec_args("h264_nvenc", "h264Gpu", &req, Some(10.0));

        assert!(args.windows(2).any(|w| w == ["-b:v", "9000k"]));
        assert!(args.windows(2).any(|w| w == ["-maxrate", "12600k"]));
    }

    #[test]
    fn video_resolution_scale_preserves_aspect_ratio_without_crop_or_zoom() {
        assert_eq!(
            resolution_to_scale("1080p"),
            Some("scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1".into())
        );
        assert_eq!(
            resolution_to_scale("720p"),
            Some("scale=1280:720:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1".into())
        );
    }

    #[test]
    fn video_resolution_is_added_to_output_name() {
        let mut req = video_req("auto", "CRF", 24, 0);
        req.input_path = r"C:\media\clip.mp4".into();
        req.resolution = "1080p".into();

        let output = derive_output_path_with_tag(
            &req.input_path,
            "",
            "mp4",
            video_output_name_tag(&req),
        );

        assert_eq!(output.file_name().unwrap().to_string_lossy(), "clip_1080p_compressed.mp4");
    }

    #[test]
    fn jpeg_image_args_flatten_alpha_on_white() {
        let args = build_image_args("input.png", "out.jpg", "JPEG", 82, Some((1920, 1080)));

        assert!(args.windows(2).any(|w| w == ["-f", "lavfi"]));
        assert!(args.windows(2).any(|w| w == ["-i", "color=c=white:s=1920x1080"]));
        assert!(args.windows(2).any(|w| w == ["-filter_complex", "[0:v]format=rgba[fg];[1:v][fg]overlay=format=auto,format=yuvj420p"]));
        assert!(args.windows(2).any(|w| w == ["-q:v", "8"]));
        assert!(args.windows(2).any(|w| w == ["-map_metadata", "-1"]));
    }

    #[test]
    fn webp_image_args_use_picture_preset_and_quality() {
        let args = build_image_args("input.png", "out.webp", "WebP", 70, Some((800, 600)));

        assert!(args.windows(2).any(|w| w == ["-c:v", "libwebp"]));
        assert!(args.windows(2).any(|w| w == ["-preset", "picture"]));
        assert!(args.windows(2).any(|w| w == ["-quality", "70"]));
        assert!(args.windows(2).any(|w| w == ["-compression_level", "6"]));
    }

    #[test]
    fn gif_filter_gets_smaller_for_aggressive_quality() {
        assert_eq!(gif_filter_for_crf(24), "fps=12,scale=640:-1:flags=lanczos");
        assert_eq!(gif_filter_for_crf(31), "fps=8,scale=420:-1:flags=lanczos");
    }

    #[test]
    fn supports_common_media_and_raw_extensions() {
        assert_eq!(file_type_from_extension("mp4"), Some("video"));
        assert_eq!(file_type_from_extension("heic"), Some("image"));
        assert_eq!(file_type_from_extension("tiff"), Some("image"));
        assert_eq!(file_type_from_extension("dng"), Some("image"));
        assert_eq!(file_type_from_extension("pdf"), Some("pdf"));
        assert_eq!(file_type_from_extension("txt"), None);
    }

    #[test]
    fn wide_image_inputs_prefer_vips_or_magick() {
        assert_eq!(preferred_image_tool("dng", "JPEG"), "vips-or-magick");
        assert_eq!(preferred_image_tool("heic", "JPEG"), "vips-or-magick");
        assert_eq!(preferred_image_tool("png", "PNG"), "ffmpeg-plus-png-optimizers");
    }

    #[test]
    fn vips_copy_args_preserve_dimensions() {
        let args = build_vips_args("input.dng", "out.jpg", "JPEG", 82);

        assert_eq!(args[0], "copy");
        assert_eq!(args[1], "input.dng");
        assert_eq!(args[2], "out.jpg[Q=82,strip]");
    }

    #[test]
    fn mutool_args_use_clean_and_deflate() {
        let args = build_mutool_pdf_args("input.pdf", "out.pdf");

        assert_eq!(args, vec!["clean", "-gggg", "-d", "input.pdf", "out.pdf"]);
    }

    #[test]
    fn collect_supported_paths_recurses_directories() {
        let root = std::env::temp_dir().join(format!("xcompress-test-{}", std::process::id()));
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("clip.mp4"), b"video").unwrap();
        std::fs::write(nested.join("photo.dng"), b"raw").unwrap();
        std::fs::write(nested.join("notes.txt"), b"ignore").unwrap();

        let files = collect_supported_paths(vec![root.to_string_lossy().into_owned()]);
        let names: Vec<String> = files.into_iter().map(|file| file.name).collect();

        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!(names, vec!["clip.mp4".to_string(), "photo.dng".to_string()]);
    }
}
