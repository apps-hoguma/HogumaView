#[cfg(target_os = "windows")]
use libloading::Library;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::ffi::{c_void, CStr, CString};
#[cfg(target_os = "windows")]
use std::os::raw::{c_char, c_int};
#[cfg(target_os = "windows")]
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::sync::{
    atomic::{AtomicBool, Ordering as AtomicOrdering},
    Arc, Mutex, OnceLock,
};
#[cfg(target_os = "windows")]
use std::thread::{self, JoinHandle};
#[cfg(target_os = "windows")]
use std::time::Duration;
use std::time::SystemTime;
use tauri::ipc::Response;
use tauri::Emitter;
use tauri::Manager;
use tokio::io::AsyncReadExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Shell::{ShellExecuteW, StrCmpLogicalW};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPI_SETDESKWALLPAPER, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE,
};
#[cfg(target_os = "windows")]
use windows::{
    core::{BOOL, PCWSTR},
    Win32::{
        Graphics::DirectWrite::{
            DWriteCreateFactory, DWRITE_FACTORY_TYPE_SHARED, IDWriteFactory, IDWriteFontCollection,
            IDWriteLocalizedStrings,
        },
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED},
    },
};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileLoadProgress {
    request_id: String,
    loaded: u64,
    total: u64,
    progress: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FolderSortDebug {
    input_path: String,
    input_key: String,
    directory: String,
    source: String,
    matched_window: bool,
    explorer_order_count: usize,
    filtered_file_count: usize,
    matched_file_count: usize,
    folder_image_index: isize,
    sort_columns_raw: String,
    first_explorer: Vec<String>,
    first_sorted: Vec<String>,
    first_filtered: Vec<String>,
    note: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImageMetadata {
    path: String,
    file_name: String,
    extension: String,
    file_size_bytes: u64,
    readonly: bool,
    created_unix_ms: Option<u64>,
    modified_unix_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExifDetail {
    property_name: String,
    value: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstalledFontFamily {
    css_name: String,
    display_name: String,
    aliases: Vec<String>,
}

fn system_time_to_unix_ms(t: SystemTime) -> Option<u64> {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
}

#[cfg(target_os = "windows")]
fn command_hidden(program: impl AsRef<std::ffi::OsStr>) -> Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(target_os = "windows"))]
fn command_hidden(program: impl AsRef<std::ffi::OsStr>) -> Command {
    Command::new(program)
}

#[cfg(target_os = "windows")]
fn powershell_hidden_command() -> Command {
    command_hidden("powershell.exe")
}

#[tauri::command]
fn get_image_metadata(path: String) -> Result<ImageMetadata, String> {
    let src = std::path::PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let meta = std::fs::metadata(&src).map_err(|e| format!("failed to read metadata: {e}"))?;
    let file_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let created_unix_ms = meta.created().ok().and_then(system_time_to_unix_ms);
    let modified_unix_ms = meta.modified().ok().and_then(system_time_to_unix_ms);

    Ok(ImageMetadata {
        path: src.to_string_lossy().to_string(),
        file_name,
        extension,
        file_size_bytes: meta.len(),
        readonly: meta.permissions().readonly(),
        created_unix_ms,
        modified_unix_ms,
    })
}

#[tauri::command]
fn get_exif_details(path: String) -> Result<Vec<ExifDetail>, String> {
    let src = std::path::PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }
    let file = std::fs::File::open(&src).map_err(|e| format!("failed to open file: {e}"))?;
    let mut reader = std::io::BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut reader) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()),
    };

    let mut rows = Vec::<ExifDetail>::new();
    for field in exif.fields() {
        let value = field.display_value().with_unit(&exif).to_string();
        let normalized = value.trim().replace('\u{0}', "");
        if normalized.is_empty() {
            continue;
        }
        rows.push(ExifDetail {
            property_name: format!("{:?}:{}", field.ifd_num, field.tag),
            value: normalized,
        });
    }
    Ok(rows)
}

#[tauri::command]
fn is_hdr_jpeg(path: String) -> Result<bool, String> {
    let src = std::path::PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ext != "jpg" && ext != "jpeg" && ext != "jpe" && ext != "jfif" {
        return Ok(false);
    }

    let mut file = std::fs::File::open(&src).map_err(|e| format!("failed to open file: {e}"))?;
    let mut probe = vec![0u8; 4 * 1024 * 1024];
    let read_len = std::io::Read::read(&mut file, &mut probe)
        .map_err(|e| format!("failed to read file: {e}"))?;
    probe.truncate(read_len);

    if probe.len() < 4 || probe[0] != 0xFF || probe[1] != 0xD8 {
        return Ok(false);
    }

    let text = String::from_utf8_lossy(&probe).to_ascii_lowercase();
    let xmp_hdr_markers = [
        "hdrgm:",
        "hdr gain map",
        "hdrgainmap",
        "gainmap",
        "ultrahdr",
        "http://ns.adobe.com/hdr-gain-map/1.0/",
    ];
    if xmp_hdr_markers.iter().any(|marker| text.contains(marker)) {
        return Ok(true);
    }

    // Some gain-map JPEGs may not expose explicit XMP strings in the probe window.
    // In that case, require both MPF container marker and gain-map hint.
    let has_mpf = probe.windows(4).any(|w| w == b"MPF\0");
    let has_gain_hint = text.contains("gain map") || text.contains("gainmap") || text.contains("hdrgm:");
    Ok(has_mpf && has_gain_hint)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn list_installed_font_families() -> Result<Vec<InstalledFontFamily>, String> {
    Ok(list_installed_font_families_directwrite())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn list_installed_font_families() -> Result<Vec<InstalledFontFamily>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn normalize_font_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('@') {
        return None;
    }
    Some(trimmed.to_string())
}

#[cfg(target_os = "windows")]
fn dedupe_font_aliases(candidates: Vec<String>) -> Vec<String> {
    let mut rows: Vec<String> = Vec::new();
    for alias in candidates {
        let Some(normalized) = normalize_font_name(&alias) else {
            continue;
        };
        if rows
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&normalized))
        {
            continue;
        }
        rows.push(normalized);
    }
    rows
}

#[cfg(target_os = "windows")]
fn get_localized_name(names: &IDWriteLocalizedStrings, locale: &str) -> Option<String> {
    let locale_wide: Vec<u16> = locale
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut index: u32 = 0;
    unsafe {
        let mut exists = BOOL(0);
        if names
            .FindLocaleName(PCWSTR(locale_wide.as_ptr()), &mut index, &mut exists)
            .is_err()
        {
            return None;
        }
        if !exists.as_bool() {
            return None;
        }
    }
    get_name_at(names, index)
}

#[cfg(target_os = "windows")]
fn get_first_name(names: &IDWriteLocalizedStrings) -> Option<String> {
    get_name_at(names, 0)
}

#[cfg(target_os = "windows")]
fn get_name_at(names: &IDWriteLocalizedStrings, index: u32) -> Option<String> {
    unsafe {
        let len = names.GetStringLength(index).ok()?;
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        if names.GetString(index, &mut buf).is_err() {
            return None;
        }
        let text = String::from_utf16_lossy(&buf[..len as usize]);
        normalize_font_name(&text)
    }
}

#[cfg(target_os = "windows")]
fn list_installed_font_families_directwrite() -> Vec<InstalledFontFamily> {
    let mut result: Vec<InstalledFontFamily> = Vec::new();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IDWriteFactory = match DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED) {
            Ok(value) => value,
            Err(_) => {
                CoUninitialize();
                return Vec::new();
            }
        };
        let mut collection_opt: Option<IDWriteFontCollection> = None;
        if factory
            .GetSystemFontCollection(&mut collection_opt, false)
            .is_err()
        {
            CoUninitialize();
            return Vec::new();
        }
        let collection = match collection_opt {
            Some(value) => value,
            None => {
                CoUninitialize();
                return Vec::new();
            }
        };

        let family_count = collection.GetFontFamilyCount();
        for i in 0..family_count {
            let family = match collection.GetFontFamily(i) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let family_names = match family.GetFamilyNames() {
                Ok(value) => value,
                Err(_) => continue,
            };
            let ko_kr = get_localized_name(&family_names, "ko-kr");
            let ko = get_localized_name(&family_names, "ko");
            let en_us = get_localized_name(&family_names, "en-us");
            let en = get_localized_name(&family_names, "en");
            let first = get_first_name(&family_names);
            let css_name = en_us
                .clone()
                .or_else(|| en.clone())
                .or_else(|| first.clone())
                .and_then(|value| normalize_font_name(&value))
                .unwrap_or_default();
            let display_name = ko_kr
                .clone()
                .or_else(|| ko.clone())
                .or_else(|| first.clone())
                .and_then(|value| normalize_font_name(&value))
                .unwrap_or_else(|| css_name.clone());
            if css_name.is_empty() || display_name.is_empty() {
                continue;
            }
            let aliases = dedupe_font_aliases(vec![
                css_name.clone(),
                display_name.clone(),
                ko_kr.unwrap_or_default(),
                ko.unwrap_or_default(),
                en_us.unwrap_or_default(),
                en.unwrap_or_default(),
                first.unwrap_or_default(),
            ]);
            result.push(InstalledFontFamily {
                css_name,
                display_name,
                aliases,
            });
        }
        CoUninitialize();
    }
    result.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    result.dedup_by(|a, b| a.css_name.eq_ignore_ascii_case(&b.css_name));
    result
}

#[tauri::command]
async fn read_file_with_progress(
    app: tauri::AppHandle,
    path: String,
    request_id: String,
) -> Result<(), String> {
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("failed to open file: {e}"))?;
    let total = file
        .metadata()
        .await
        .map_err(|e| format!("failed to read metadata: {e}"))?
        .len();

    let mut buf = vec![0_u8; 256 * 1024];
    let mut loaded = 0_u64;

    loop {
        let n = file
            .read(&mut buf)
            .await
            .map_err(|e| format!("failed while reading file: {e}"))?;
        if n == 0 {
            break;
        }

        loaded += n as u64;

        let progress = if total > 0 {
            loaded as f64 / total as f64
        } else {
            0.0
        };
        let payload = FileLoadProgress {
            request_id: request_id.clone(),
            loaded,
            total,
            progress,
        };
        let _ = app.emit("file-load-progress", payload);
    }

    if total == 0 {
        let payload = FileLoadProgress {
            request_id,
            loaded: 0,
            total: 0,
            progress: 1.0,
        };
        let _ = app.emit("file-load-progress", payload);
    }

    Ok(())
}

#[tauri::command]
async fn read_image_file_bytes(path: String) -> Result<Response, String> {
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("failed to read file: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;

    // UTF-16 LE BOM
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16(&units).map_err(|e| e.to_string());
    }

    // UTF-16 BE BOM
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16(&units).map_err(|e| e.to_string());
    }

    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_launch_file_path() -> Option<String> {
    for arg in std::env::args_os().skip(1) {
        let candidate = std::path::PathBuf::from(arg);
        if candidate.as_os_str().is_empty() {
            continue;
        }
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

#[tauri::command]
async fn save_image_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("저장할 이미지 데이터가 비어 있습니다.".to_string());
    }
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| format!("failed to save file: {e}"))?;
    Ok(())
}

#[tauri::command]
fn create_temp_backup_copy(path: String) -> Result<String, String> {
    let src = std::path::PathBuf::from(&path);
    if !src.is_file() {
        return Err("source file not found".to_string());
    }
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut file_name = format!("hogumaview-meta-backup-{}-{nanos}", std::process::id());
    if !ext.is_empty() {
        file_name.push('.');
        file_name.push_str(&ext);
    }
    let temp_path = std::env::temp_dir().join(file_name);
    std::fs::copy(&src, &temp_path).map_err(|e| format!("failed to backup source file: {e}"))?;
    Ok(temp_path.to_string_lossy().to_string())
}

#[tauri::command]
fn remove_temp_file(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Ok(());
    }
    let target = std::path::PathBuf::from(path);
    if !target.exists() {
        return Ok(());
    }
    if !target.is_file() {
        return Err("target is not a file".to_string());
    }
    std::fs::remove_file(&target).map_err(|e| format!("failed to remove temp file: {e}"))?;
    Ok(())
}

fn push_exiftool_candidates_from_dir(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    out.push(dir.join("exiftool.exe"));
    out.push(dir.join("exiftool(-k).exe"));
    out.push(dir.join("exiftool"));

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_file() {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.starts_with("exiftool") && name.ends_with(".exe") {
                out.push(path);
            }
            continue;
        }
        if !file_type.is_dir() {
            continue;
        }
        if let Ok(sub_entries) = std::fs::read_dir(path) {
            for sub in sub_entries.flatten() {
                let sub_path = sub.path();
                if !sub_path.is_file() {
                    continue;
                }
                let name = sub.file_name().to_string_lossy().to_ascii_lowercase();
                if name.starts_with("exiftool") && name.ends_with(".exe") {
                    out.push(sub_path);
                }
            }
        }
    }
}

fn exiftool_search_dirs(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::<std::path::PathBuf>::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("runtime").join("exiftool"));
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            dirs.push(exe_dir.join("runtime").join("exiftool"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("runtime").join("exiftool"));
        dirs.push(cwd.join("src-tauri").join("runtime").join("exiftool"));
    }
    dirs
}

fn resolve_exiftool_command(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::<std::path::PathBuf>::new();
    for dir in exiftool_search_dirs(app) {
        push_exiftool_candidates_from_dir(&dir, &mut candidates);
    }
    candidates.push(std::path::PathBuf::from("exiftool"));
    candidates.push(std::path::PathBuf::from("exiftool.exe"));
    candidates
}

fn add_metadata_copy_args(cmd: &mut Command, source_path: &str, target_path: &str) {
    cmd.args([
        "-overwrite_original",
        "-m",
        "-q",
        "-q",
        "-TagsFromFile",
        source_path,
        "-all:all",
        "--ImageWidth",
        "--ImageHeight",
        "--ExifImageWidth",
        "--ExifImageHeight",
        "--PixelXDimension",
        "--PixelYDimension",
        "--Orientation",
        "--ThumbnailImage",
        "--PreviewImage",
        "--JpgFromRaw",
        target_path,
    ]);
}

#[tauri::command]
fn copy_metadata_fast(
    app: tauri::AppHandle,
    source_path: String,
    target_path: String,
) -> Result<String, String> {
    let src = std::path::PathBuf::from(&source_path);
    let dst = std::path::PathBuf::from(&target_path);
    if !src.is_file() {
        return Err("source file not found".to_string());
    }
    if !dst.is_file() {
        return Err("target file not found".to_string());
    }

    let mut selected_cmd: Option<std::path::PathBuf> = None;
    for candidate in resolve_exiftool_command(&app) {
        if let Ok(output) = command_hidden(&candidate).args(["-ver"]).output() {
            if output.status.success() {
                selected_cmd = Some(candidate);
                break;
            }
        }
    }
    let output = if let Some(exiftool_cmd) = selected_cmd {
        let mut cmd = command_hidden(&exiftool_cmd);
        add_metadata_copy_args(&mut cmd, source_path.as_str(), target_path.as_str());
        cmd.output()
            .map_err(|e| format!("failed to launch exiftool: {e}"))?
    } else {
        return Ok("tool_missing".to_string());
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "unknown error".to_string()
        };
        return Err(format!("exiftool failed: {detail}"));
    }

    Ok("applied".to_string())
}

#[tauri::command]
fn log_decode_route(route: String, source: String) {
    println!("[decode-route] route={route} source={source}");
}

fn read_filtered_image_files(dir: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    let allowed = [
        // Common web/standard
        "gif", "webp", "apng", "avif", "png", "jpg", "jpeg", "jpe", "jfif", "bmp", "dib", "rle",
        "tif", "tiff", "ico", "icon", "svg", "svgz", "heic", "heif", "jxl", "jp2", "j2k", "jpf",
        "jpm", "jpx", "wdp", "hdp", "tga", "dds", "exr", "hdr", "pic", "pbm", "pgm", "ppm", "pnm",
        "qoi", // Adobe / Design
        "psd", "psb", "ai", "eps", "epsf", "epsi", // GIMP
        "xcf",  // Camera RAW
        "cr2", "cr3", "nef", "nrw", "arw", "dng", "orf", "rw2", "raf", "srw", "pef", "dcr", "mrw",
        "x3f", "erf", "raw", "rwl", "kdc", // Legacy / Other
        "pcx", "pict", "pct", "sgi", "rgb", "rgba", "bpg", "cin", "dpx", "fits", "fts", "fit",
        "dcm", "cur", "ani", "xpm", "xbm", "mng", "jng", "miff", "palm", "wbmp", "otb", "pam",
        "pfm", "pgx", "vtf", "flif", "jbig", "jbig2", // PDF (first page)
        "pdf",
    ];

    let mut files = Vec::<std::path::PathBuf>::new();
    let entries = std::fs::read_dir(dir).map_err(|e| format!("폴더 읽기 실패: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("디렉터리 엔트리 읽기 실패: {e}"))?;
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let Some(ext) = p.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        let ext_lower = ext.to_ascii_lowercase();
        if allowed.iter().any(|x| *x == ext_lower) {
            files.push(p);
        }
    }

    Ok(files)
}

#[cfg(target_os = "windows")]
fn should_use_magick_decode(_ext: &str) -> bool {
    true
}

#[cfg(target_os = "windows")]
fn resolve_imagemagick_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::<PathBuf>::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("runtime").join("imagemagick-7.1.2-15"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("runtime")
            .join("imagemagick-7.1.2-15"),
    );

    for path in candidates {
        if path.is_dir() {
            return Ok(path);
        }
    }
    Err("ImageMagick runtime path not found".to_string())
}

#[cfg(target_os = "windows")]
fn resolve_vips_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::<PathBuf>::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("runtime").join("vips-dev-8.18"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("runtime")
            .join("vips-dev-8.18"),
    );

    for path in candidates {
        if path.is_dir() {
            return Ok(path);
        }
    }
    Err("vips runtime path not found".to_string())
}

#[cfg(target_os = "windows")]
fn should_use_png_thumbnail(ext: &str) -> bool {
    matches!(
        ext,
        "png"
            | "apng"
            | "gif"
            | "webp"
            | "avif"
            | "heic"
            | "heif"
            | "jxl"
            | "ico"
            | "icon"
            | "tif"
            | "tiff"
            | "qoi"
            | "svg"
            | "svgz"
    )
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct MagickWandOpaque {
    _private: [u8; 0],
}

#[cfg(target_os = "windows")]
struct MagickWandApi {
    _lib: Library,
    new_magick_wand: unsafe extern "C" fn() -> *mut MagickWandOpaque,
    destroy_magick_wand: unsafe extern "C" fn(*mut MagickWandOpaque) -> *mut MagickWandOpaque,
    magick_read_image: unsafe extern "C" fn(*mut MagickWandOpaque, *const c_char) -> u32,
    magick_set_resolution: unsafe extern "C" fn(*mut MagickWandOpaque, f64, f64) -> u32,
    magick_set_first_iterator: unsafe extern "C" fn(*mut MagickWandOpaque),
    magick_set_iterator_index: unsafe extern "C" fn(*mut MagickWandOpaque, isize) -> u32,
    magick_get_number_images: unsafe extern "C" fn(*mut MagickWandOpaque) -> usize,
    magick_auto_orient_image: Option<unsafe extern "C" fn(*mut MagickWandOpaque) -> u32>,
    magick_gamma_image: Option<unsafe extern "C" fn(*mut MagickWandOpaque, f64) -> u32>,
    magick_linear_stretch_image: Option<unsafe extern "C" fn(*mut MagickWandOpaque, f64, f64) -> u32>,
    magick_transform_image_colorspace: Option<unsafe extern "C" fn(*mut MagickWandOpaque, u32) -> u32>,
    magick_get_image_width: unsafe extern "C" fn(*mut MagickWandOpaque) -> usize,
    magick_get_image_height: unsafe extern "C" fn(*mut MagickWandOpaque) -> usize,
    magick_scale_image: unsafe extern "C" fn(*mut MagickWandOpaque, usize, usize) -> u32,
    magick_export_image_pixels: unsafe extern "C" fn(
        *mut MagickWandOpaque,
        isize,
        isize,
        usize,
        usize,
        *const c_char,
        c_int,
        *mut c_void,
    ) -> u32,
    magick_import_image_pixels: unsafe extern "C" fn(
        *mut MagickWandOpaque,
        isize,
        isize,
        usize,
        usize,
        *const c_char,
        c_int,
        *const c_void,
    ) -> u32,
    magick_write_image: unsafe extern "C" fn(*mut MagickWandOpaque, *const c_char) -> u32,
    magick_get_exception: unsafe extern "C" fn(*mut MagickWandOpaque, *mut c_int) -> *mut c_char,
    magick_relinquish_memory: unsafe extern "C" fn(*mut c_void) -> *mut c_void,
}

#[cfg(target_os = "windows")]
fn is_vector_decode_ext(ext: &str) -> bool {
    matches!(ext, "pdf" | "ai" | "eps" | "epsf" | "epsi" | "svg" | "svgz")
}

#[cfg(target_os = "windows")]
fn is_hdr_decode_ext(ext: &str) -> bool {
    matches!(ext, "hdr" | "exr")
}

#[cfg(target_os = "windows")]
fn is_wide_gamut_ext(ext: &str) -> bool {
    matches!(ext, "avif" | "heic" | "heif" | "jxl")
}


#[cfg(target_os = "windows")]
fn set_imagemagick_env(runtime_dir: &std::path::Path) {
    let runtime = runtime_dir.to_string_lossy().to_string();
    let coders = runtime_dir.join("modules").join("coders");
    let filters = runtime_dir.join("modules").join("filters");
    let ghostscript_root = runtime_dir
        .parent()
        .map(|p| p.join("ghostscript"))
        .unwrap_or_else(|| runtime_dir.join("..").join("ghostscript"));
    let ghostscript_bin = ghostscript_root.join("bin");
    let ghostscript_exe = ghostscript_bin.join("gswin64c.exe");
    let windows_fonts = std::path::Path::new(r"C:\Windows\Fonts");

    std::env::set_var("MAGICK_HOME", &runtime);
    std::env::set_var("MAGICK_CONFIGURE_PATH", &runtime);
    std::env::set_var(
        "MAGICK_CODER_MODULE_PATH",
        coders.to_string_lossy().to_string(),
    );
    std::env::set_var(
        "MAGICK_CODER_FILTER_PATH",
        filters.to_string_lossy().to_string(),
    );
    if ghostscript_exe.is_file() {
        std::env::set_var(
            "MAGICK_GHOSTSCRIPT_PATH",
            ghostscript_exe.to_string_lossy().to_string(),
        );
        std::env::set_var("GS_PROG", ghostscript_exe.to_string_lossy().to_string());
    }
    if windows_fonts.is_dir() {
        std::env::set_var("GS_FONTPATH", windows_fonts.to_string_lossy().to_string());
    }

    let old_path = std::env::var("PATH").unwrap_or_default();
    let old_path_lower = old_path.to_ascii_lowercase();
    let mut prepend = Vec::<String>::new();
    if !old_path_lower.contains(&runtime.to_ascii_lowercase()) {
        prepend.push(runtime);
    }
    let gs_bin = ghostscript_bin.to_string_lossy().to_string();
    if ghostscript_bin.is_dir() && !old_path_lower.contains(&gs_bin.to_ascii_lowercase()) {
        prepend.push(gs_bin);
    }
    if !prepend.is_empty() {
        let merged = if old_path.is_empty() {
            prepend.join(";")
        } else {
            format!("{};{old_path}", prepend.join(";"))
        };
        std::env::set_var("PATH", merged);
    }
}

#[cfg(target_os = "windows")]
fn load_magickwand_api(runtime_dir: &std::path::Path) -> Result<MagickWandApi, String> {
    let dll_path = runtime_dir.join("CORE_RL_MagickWand_.dll");
    if !dll_path.is_file() {
        return Err(format!(
            "MagickWand DLL missing: {}",
            dll_path.to_string_lossy()
        ));
    }

    unsafe {
        let lib =
            Library::new(&dll_path).map_err(|e| format!("failed to load MagickWand DLL: {e}"))?;

        let magick_wand_genesis = *lib
            .get::<unsafe extern "C" fn()>(b"MagickWandGenesis\0")
            .map_err(|e| format!("failed to resolve MagickWandGenesis: {e}"))?;
        let new_magick_wand = *lib
            .get::<unsafe extern "C" fn() -> *mut MagickWandOpaque>(b"NewMagickWand\0")
            .map_err(|e| format!("failed to resolve NewMagickWand: {e}"))?;
        let destroy_magick_wand = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque) -> *mut MagickWandOpaque>(
                b"DestroyMagickWand\0",
            )
            .map_err(|e| format!("failed to resolve DestroyMagickWand: {e}"))?;
        let magick_read_image = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, *const c_char) -> u32>(
                b"MagickReadImage\0",
            )
            .map_err(|e| format!("failed to resolve MagickReadImage: {e}"))?;
        let magick_set_resolution = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, f64, f64) -> u32>(
                b"MagickSetResolution\0",
            )
            .map_err(|e| format!("failed to resolve MagickSetResolution: {e}"))?;
        let magick_set_first_iterator = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque)>(b"MagickSetFirstIterator\0")
            .map_err(|e| format!("failed to resolve MagickSetFirstIterator: {e}"))?;
        let magick_set_iterator_index = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, isize) -> u32>(
                b"MagickSetIteratorIndex\0",
            )
            .map_err(|e| format!("failed to resolve MagickSetIteratorIndex: {e}"))?;
        let magick_get_number_images = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque) -> usize>(b"MagickGetNumberImages\0")
            .map_err(|e| format!("failed to resolve MagickGetNumberImages: {e}"))?;
        let magick_auto_orient_image = lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque) -> u32>(b"MagickAutoOrientImage\0")
            .ok()
            .map(|sym| *sym);
        let magick_gamma_image = lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, f64) -> u32>(b"MagickGammaImage\0")
            .ok()
            .map(|sym| *sym);
        let magick_linear_stretch_image = lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, f64, f64) -> u32>(
                b"MagickLinearStretchImage\0",
            )
            .ok()
            .map(|sym| *sym);
        let magick_transform_image_colorspace = lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, u32) -> u32>(
                b"MagickTransformImageColorspace\0",
            )
            .ok()
            .map(|sym| *sym);
        let magick_get_image_width = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque) -> usize>(b"MagickGetImageWidth\0")
            .map_err(|e| format!("failed to resolve MagickGetImageWidth: {e}"))?;
        let magick_get_image_height = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque) -> usize>(b"MagickGetImageHeight\0")
            .map_err(|e| format!("failed to resolve MagickGetImageHeight: {e}"))?;
        let magick_scale_image = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, usize, usize) -> u32>(
                b"MagickScaleImage\0",
            )
            .map_err(|e| format!("failed to resolve MagickScaleImage: {e}"))?;
        let magick_export_image_pixels = *lib
            .get::<unsafe extern "C" fn(
                *mut MagickWandOpaque,
                isize,
                isize,
                usize,
                usize,
                *const c_char,
                c_int,
                *mut c_void,
            ) -> u32>(b"MagickExportImagePixels\0")
            .map_err(|e| format!("failed to resolve MagickExportImagePixels: {e}"))?;
        let magick_import_image_pixels = *lib
            .get::<unsafe extern "C" fn(
                *mut MagickWandOpaque,
                isize,
                isize,
                usize,
                usize,
                *const c_char,
                c_int,
                *const c_void,
            ) -> u32>(b"MagickImportImagePixels\0")
            .map_err(|e| format!("failed to resolve MagickImportImagePixels: {e}"))?;
        let magick_write_image = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, *const c_char) -> u32>(
                b"MagickWriteImage\0",
            )
            .map_err(|e| format!("failed to resolve MagickWriteImage: {e}"))?;
        let magick_get_exception = *lib
            .get::<unsafe extern "C" fn(*mut MagickWandOpaque, *mut c_int) -> *mut c_char>(
                b"MagickGetException\0",
            )
            .map_err(|e| format!("failed to resolve MagickGetException: {e}"))?;
        let magick_relinquish_memory = *lib
            .get::<unsafe extern "C" fn(*mut c_void) -> *mut c_void>(b"MagickRelinquishMemory\0")
            .map_err(|e| format!("failed to resolve MagickRelinquishMemory: {e}"))?;

        magick_wand_genesis();

        Ok(MagickWandApi {
            _lib: lib,
            new_magick_wand,
            destroy_magick_wand,
            magick_read_image,
            magick_set_resolution,
            magick_set_first_iterator,
            magick_set_iterator_index,
            magick_get_number_images,
            magick_auto_orient_image,
            magick_gamma_image,
            magick_linear_stretch_image,
            magick_transform_image_colorspace,
            magick_get_image_width,
            magick_get_image_height,
            magick_scale_image,
            magick_export_image_pixels,
            magick_import_image_pixels,
            magick_write_image,
            magick_get_exception,
            magick_relinquish_memory,
        })
    }
}

#[cfg(target_os = "windows")]
fn magickwand_api(app: &tauri::AppHandle) -> Result<&'static MagickWandApi, String> {
    static API: OnceLock<Result<MagickWandApi, String>> = OnceLock::new();

    let result = API.get_or_init(|| {
        let runtime_dir = match resolve_imagemagick_dir(app) {
            Ok(v) => v,
            Err(e) => return Err(e),
        };
        set_imagemagick_env(&runtime_dir);
        load_magickwand_api(&runtime_dir)
    });

    match result {
        Ok(api) => Ok(api),
        Err(e) => Err(e.clone()),
    }
}

#[cfg(target_os = "windows")]
fn wand_exception_message(
    api: &MagickWandApi,
    wand: *mut MagickWandOpaque,
    fallback: &str,
) -> String {
    unsafe {
        let mut severity: c_int = 0;
        let msg_ptr = (api.magick_get_exception)(wand, &mut severity as *mut c_int);
        if msg_ptr.is_null() {
            return fallback.to_string();
        }
        let message = CStr::from_ptr(msg_ptr).to_string_lossy().into_owned();
        (api.magick_relinquish_memory)(msg_ptr as *mut c_void);
        if message.trim().is_empty() {
            fallback.to_string()
        } else {
            format!("{fallback}: {message}")
        }
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn decode_with_magick(
    app: tauri::AppHandle,
    path: String,
    max_width: Option<usize>,
    max_height: Option<usize>,
    render_dpi: Option<f64>,
    frame_index: Option<usize>,
) -> Result<Response, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if !should_use_magick_decode(&ext) {
        return Err("unsupported extension for decode_with_magick".to_string());
    }

    let api = magickwand_api(&app)?;
    let src_text = src.to_string_lossy().to_string();
    let src_c = CString::new(src_text).map_err(|_| "invalid path for MagickWand".to_string())?;
    let map_rgba = CString::new("RGBA").map_err(|_| "failed to prepare RGBA map".to_string())?;

    unsafe {
        let wand = (api.new_magick_wand)();
        if wand.is_null() {
            return Err("NewMagickWand returned null".to_string());
        }

        if is_vector_decode_ext(&ext) {
            let requested = render_dpi.unwrap_or(72.0);
            let dpi = requested.clamp(72.0, 600.0);
            let res_ok = (api.magick_set_resolution)(wand, dpi, dpi);
            if res_ok == 0 {
                let err = wand_exception_message(api, wand, "MagickSetResolution failed");
                let _ = (api.destroy_magick_wand)(wand);
                return Err(err);
            }
        }

        let read_ok = (api.magick_read_image)(wand, src_c.as_ptr());
        if read_ok == 0 {
            let err = wand_exception_message(api, wand, "MagickReadImage failed");
            let _ = (api.destroy_magick_wand)(wand);
            return Err(err);
        }

        (api.magick_set_first_iterator)(wand);
        if let Some(index) = frame_index {
            let set_ok = (api.magick_set_iterator_index)(wand, index as isize);
            if set_ok == 0 {
                let err = wand_exception_message(api, wand, "MagickSetIteratorIndex failed");
                let _ = (api.destroy_magick_wand)(wand);
                return Err(err);
            }
        }

        // Respect EXIF orientation from phone cameras by normalizing pixels upfront.
        // If this symbol is unavailable or fails, continue without blocking decode.
        if let Some(auto_orient) = api.magick_auto_orient_image {
            let _ = auto_orient(wand);
        }

        let mut width = (api.magick_get_image_width)(wand);
        let mut height = (api.magick_get_image_height)(wand);
        let original_width = width;
        let original_height = height;

        // Wide-gamut formats (AVIF, HEIC, JXL) may use BT.2020 color primaries.
        // Without converting to sRGB first, the raw BT.2020 values are interpreted as sRGB
        // on export, making colors look desaturated/washed out.
        // sRGBColorspace = 23 in ImageMagick 7's ColorspaceType enum.
        if is_wide_gamut_ext(&ext) {
            if let Some(transform_cs) = api.magick_transform_image_colorspace {
                const SRGB_COLORSPACE: u32 = 23;
                let _ = transform_cs(wand, SRGB_COLORSPACE);
            }
        }

        // Tone-map HDR content into SDR output before exporting 8-bit pixels.
        // LinearStretch clips the top 0.5% of highlight pixels (e.g. sun hotspots in HDRIs)
        // so the remaining dynamic range maps cleanly to 0-1, then gamma 2.2 converts
        // linear light to sRGB-like perceptual encoding (output = input^(1/2.2)).
        // AutoLevel and AutoGamma are avoided: AutoLevel uses the absolute max as reference
        // (making everything else near-black for HDRIs with extreme highlights), and
        // AutoGamma over-brightens by targeting 50% mean gray.
        if is_hdr_decode_ext(&ext) && width > 0 && height > 0 {
            if let Some(linear_stretch) = api.magick_linear_stretch_image {
                // Clip brightest 0.5% of pixels (highlight hotspots like the sun).
                let total_pixels = (width * height) as f64;
                let white_point = total_pixels * 0.005;
                if linear_stretch(wand, 0.0, white_point) == 0 {
                    let err =
                        wand_exception_message(api, wand, "MagickLinearStretchImage failed");
                    let _ = (api.destroy_magick_wand)(wand);
                    return Err(err);
                }
            }
            if let Some(gamma_image) = api.magick_gamma_image {
                // gamma=2.2: applies input^(1/2.2), converting linear HDR to sRGB encoding.
                if gamma_image(wand, 2.2) == 0 {
                    let err = wand_exception_message(api, wand, "MagickGammaImage failed");
                    let _ = (api.destroy_magick_wand)(wand);
                    return Err(err);
                }
            }
        }
        if width == 0 || height == 0 {
            let err = wand_exception_message(api, wand, "invalid image size");
            let _ = (api.destroy_magick_wand)(wand);
            return Err(err);
        }

        if let (Some(max_w), Some(max_h)) = (max_width, max_height) {
            if max_w > 0 && max_h > 0 && (width > max_w || height > max_h) {
                let scale_w = max_w as f64 / width as f64;
                let scale_h = max_h as f64 / height as f64;
                let scale = scale_w.min(scale_h);
                let target_w = ((width as f64 * scale).floor() as usize).max(1);
                let target_h = ((height as f64 * scale).floor() as usize).max(1);
                let scale_ok = (api.magick_scale_image)(wand, target_w, target_h);
                if scale_ok == 0 {
                    let err = wand_exception_message(api, wand, "MagickScaleImage failed");
                    let _ = (api.destroy_magick_wand)(wand);
                    return Err(err);
                }
                width = (api.magick_get_image_width)(wand);
                height = (api.magick_get_image_height)(wand);
            }
        }

        let pixel_bytes = width
            .checked_mul(height)
            .and_then(|v| v.checked_mul(4))
            .ok_or_else(|| "image size overflow".to_string())?;

        let total_len = 20 + pixel_bytes;
        let mut out = vec![0_u8; total_len];
        out[0..4].copy_from_slice(&(width as u32).to_le_bytes());
        out[4..8].copy_from_slice(&(height as u32).to_le_bytes());
        out[8..12].copy_from_slice(&(4_u32).to_le_bytes());
        out[12..16].copy_from_slice(&(original_width as u32).to_le_bytes());
        out[16..20].copy_from_slice(&(original_height as u32).to_le_bytes());

        const CHAR_PIXEL: c_int = 1;
        let export_ok = (api.magick_export_image_pixels)(
            wand,
            0,
            0,
            width,
            height,
            map_rgba.as_ptr(),
            CHAR_PIXEL,
            out[20..].as_mut_ptr() as *mut c_void,
        );
        if export_ok == 0 {
            let err = wand_exception_message(api, wand, "MagickExportImagePixels failed");
            let _ = (api.destroy_magick_wand)(wand);
            return Err(err);
        }

        let _ = (api.destroy_magick_wand)(wand);
        Ok(Response::new(out))
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_edited_image_with_magick(
    app: tauri::AppHandle,
    source_path: String,
    target_path: String,
    width: usize,
    height: usize,
    rgba: Vec<u8>,
) -> Result<(), String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err("source file not found".to_string());
    }
    if target_path.trim().is_empty() {
        return Err("target path is empty".to_string());
    }
    if width == 0 || height == 0 {
        return Err("invalid image size".to_string());
    }
    let expected_len = width
        .checked_mul(height)
        .and_then(|v| v.checked_mul(4))
        .ok_or_else(|| "image size overflow".to_string())?;
    if rgba.len() != expected_len {
        return Err(format!(
            "invalid rgba length: expected {expected_len}, got {}",
            rgba.len()
        ));
    }

    let api = magickwand_api(&app)?;
    let src_c = CString::new(source_path).map_err(|_| "invalid source path".to_string())?;
    let target_c = CString::new(target_path).map_err(|_| "invalid target path".to_string())?;
    let map_rgba = CString::new("RGBA").map_err(|_| "failed to prepare RGBA map".to_string())?;

    unsafe {
        let wand = (api.new_magick_wand)();
        if wand.is_null() {
            return Err("NewMagickWand returned null".to_string());
        }

        let read_ok = (api.magick_read_image)(wand, src_c.as_ptr());
        if read_ok == 0 {
            let err = wand_exception_message(api, wand, "MagickReadImage failed");
            let _ = (api.destroy_magick_wand)(wand);
            return Err(err);
        }
        (api.magick_set_first_iterator)(wand);

        let src_w = (api.magick_get_image_width)(wand);
        let src_h = (api.magick_get_image_height)(wand);
        if src_w != width || src_h != height {
            let _ = (api.destroy_magick_wand)(wand);
            return Err(format!(
                "edited size mismatch: source is {}x{}, edited is {}x{}",
                src_w, src_h, width, height
            ));
        }

        const CHAR_PIXEL: c_int = 1;
        let import_ok = (api.magick_import_image_pixels)(
            wand,
            0,
            0,
            width,
            height,
            map_rgba.as_ptr(),
            CHAR_PIXEL,
            rgba.as_ptr() as *const c_void,
        );
        if import_ok == 0 {
            let err = wand_exception_message(api, wand, "MagickImportImagePixels failed");
            let _ = (api.destroy_magick_wand)(wand);
            return Err(err);
        }

        let write_ok = (api.magick_write_image)(wand, target_c.as_ptr());
        if write_ok == 0 {
            let err = wand_exception_message(api, wand, "MagickWriteImage failed");
            let _ = (api.destroy_magick_wand)(wand);
            return Err(err);
        }

        let _ = (api.destroy_magick_wand)(wand);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_or_create_vips_thumbnail(
    app: tauri::AppHandle,
    path: String,
    size: Option<u32>,
) -> Result<String, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let target_size = size.unwrap_or(160).clamp(48, 512);
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let use_png = should_use_png_thumbnail(&ext);
    let meta = std::fs::metadata(&src).map_err(|e| format!("failed to read metadata: {e}"))?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(system_time_to_unix_ms)
        .unwrap_or(0);
    let file_len = meta.len();

    let mut hasher = DefaultHasher::new();
    normalize_windows_path_key(&path).hash(&mut hasher);
    target_size.hash(&mut hasher);
    modified_ms.hash(&mut hasher);
    file_len.hash(&mut hasher);
    use_png.hash(&mut hasher);
    let key = hasher.finish();

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("failed to resolve app cache dir: {e}"))?;
    let thumb_dir = cache_root.join("thumbs-vips");
    std::fs::create_dir_all(&thumb_dir).map_err(|e| format!("failed to create thumb dir: {e}"))?;

    let output_ext = if use_png { "png" } else { "jpg" };
    let output_path = thumb_dir.join(format!("{key:016x}.{output_ext}"));
    if output_path.is_file() {
        return Ok(output_path.to_string_lossy().to_string());
    }

    let vips_dir = resolve_vips_dir(&app)?;
    let vips_bin = vips_dir.join("bin");
    let vips_thumb_exe = vips_bin.join("vipsthumbnail.exe");
    if !vips_thumb_exe.is_file() {
        return Err(format!(
            "vipsthumbnail.exe not found: {}",
            vips_thumb_exe.to_string_lossy()
        ));
    }

    let old_path = std::env::var("PATH").unwrap_or_default();
    let merged_path = if old_path.is_empty() {
        vips_bin.to_string_lossy().to_string()
    } else {
        format!("{};{old_path}", vips_bin.to_string_lossy())
    };

    let src_text = src.to_string_lossy().to_string();
    let output_spec = if use_png {
        format!("{}[compression=6]", output_path.to_string_lossy())
    } else {
        format!("{}[Q=82,optimize_coding]", output_path.to_string_lossy())
    };
    let output = command_hidden(&vips_thumb_exe)
        .current_dir(&vips_bin)
        .env("PATH", merged_path)
        .args([
            src_text.as_str(),
            "-s",
            &target_size.to_string(),
            "-o",
            output_spec.as_str(),
        ])
        .output()
        .map_err(|e| format!("failed to launch vipsthumbnail: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "unknown error".to_string()
        };
        return Err(format!("vipsthumbnail failed: {detail}"));
    }

    if !output_path.is_file() {
        return Err("thumbnail file was not created".to_string());
    }

    Ok(output_path.to_string_lossy().to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn decode_with_magick(
    _app: tauri::AppHandle,
    _path: String,
    _max_width: Option<usize>,
    _max_height: Option<usize>,
    _render_dpi: Option<f64>,
    _frame_index: Option<usize>,
) -> Result<Response, String> {
    Err("decode_with_magick is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_edited_image_with_magick(
    _app: tauri::AppHandle,
    _source_path: String,
    _target_path: String,
    _width: usize,
    _height: usize,
    _rgba: Vec<u8>,
) -> Result<(), String> {
    Err("save_edited_image_with_magick is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_or_create_vips_thumbnail(
    _app: tauri::AppHandle,
    _path: String,
    _size: Option<u32>,
) -> Result<String, String> {
    Err("get_or_create_vips_thumbnail is only supported on Windows".to_string())
}

fn clear_vips_thumbnail_cache_on_exit(app: &tauri::AppHandle) {
    let Ok(cache_root) = app.path().app_cache_dir() else {
        return;
    };
    let thumb_dir = cache_root.join("thumbs-vips");
    if !thumb_dir.exists() {
        return;
    }
    let _ = std::fs::remove_dir_all(thumb_dir);
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn delete_image_file(path: String) -> Result<(), String> {

    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }
    let escaped = path.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{escaped}',[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
    );

    let status = powershell_hidden_command()
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status()
        .map_err(|e| format!("failed to launch recycle command: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "recycle command exited with status {}",
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn delete_image_file(_path: String) -> Result<(), String> {
    Err("delete_image_file is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn print_image_file(path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    fn to_wide_null(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let op = to_wide_null("print");
    let file = to_wide_null(&path);
    let rc = unsafe {
        // hWnd=0, lpParameters/lpDirectory=null, nShowCmd=0
        ShellExecuteW(
            0 as _,
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
        )
    } as isize;

    if rc > 32 {
        Ok(())
    } else {
        Err(format!("ShellExecuteW(print) failed with code {rc}"))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn print_image_file(_path: String) -> Result<(), String> {
    Err("print_image_file is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_file_to_clipboard(path: String) -> Result<(), String> {

    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let escaped = path.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         $list = New-Object System.Collections.Specialized.StringCollection; \
         [void]$list.Add('{escaped}'); \
         [System.Windows.Forms.Clipboard]::SetFileDropList($list)"
    );

    let output = powershell_hidden_command()
        .args(["-NoProfile", "-Sta", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("failed to launch clipboard command: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "no error output".to_string()
        };
        Err(format!(
            "copy file command exited with status {}: {}",
            output
                .status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            detail
        ))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn copy_file_to_clipboard(_path: String) -> Result<(), String> {
    Err("copy_file_to_clipboard is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn rotate_image_file(app: tauri::AppHandle, path: String, degrees: i32) -> Result<(), String> {

    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let normalized = match degrees {
        90 | -90 | 180 | -180 | 270 | -270 => degrees,
        _ => return Err("unsupported rotate degrees".to_string()),
    };

    let runtime_dir = resolve_imagemagick_dir(&app)?;
    set_imagemagick_env(&runtime_dir);
    let magick_exe = runtime_dir.join("magick.exe");
    if !magick_exe.is_file() {
        return Err(format!(
            "magick.exe not found: {}",
            magick_exe.to_string_lossy()
        ));
    }

    let output = command_hidden(&magick_exe)
        .arg("mogrify")
        .arg("-rotate")
        .arg(normalized.to_string())
        .arg(&path)
        .output()
        .map_err(|e| format!("failed to run rotate command: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "no error output".to_string()
        };
        Err(format!(
            "rotate command exited with status {}: {}",
            output
                .status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            detail
        ))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn rotate_image_file(_app: tauri::AppHandle, _path: String, _degrees: i32) -> Result<(), String> {
    Err("rotate_image_file is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_desktop_wallpaper(path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let mut wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            wide.as_mut_ptr() as *mut _,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
    };

    if ok != 0 {
        Ok(())
    } else {
        Err("failed to set desktop wallpaper".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_desktop_wallpaper(_path: String) -> Result<(), String> {
    Err("set_desktop_wallpaper is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn reveal_file_in_explorer(path: String) -> Result<(), String> {

    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err("file not found".to_string());
    }

    // Explorer does not handle Win32 long-path prefixes (\\?\) reliably.
    let canonical = std::fs::canonicalize(&src).unwrap_or(src);
    let mut normalized = canonical.to_string_lossy().to_string().replace('/', "\\");
    if let Some(rest) = normalized.strip_prefix(r"\\?\UNC\") {
        normalized = format!(r"\\{}", rest);
    } else if let Some(rest) = normalized.strip_prefix(r"\\?\") {
        normalized = rest.to_string();
    }

    Command::new("explorer.exe")
        .arg("/select,")
        .arg(normalized)
        .spawn()
        .map_err(|e| format!("failed to run explorer: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn reveal_file_in_explorer(_path: String) -> Result<(), String> {
    Err("reveal_file_in_explorer is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_lockscreen_wallpaper(path: String) -> Result<(), String> {

    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let escaped = path.replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         $fileOp=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]::GetFileFromPathAsync('{escaped}'); \
         while ($fileOp.Status -eq 0) {{ Start-Sleep -Milliseconds 20 }}; \
         if ($fileOp.Status -ne 1) {{ throw \"GetFileFromPathAsync failed with status $($fileOp.Status)\" }}; \
         $f=$fileOp.GetResults(); \
         $setOp=[Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime]::SetImageFileAsync($f); \
         while ($setOp.Status -eq 0) {{ Start-Sleep -Milliseconds 20 }}; \
         if ($setOp.Status -ne 1) {{ throw \"SetImageFileAsync failed with status $($setOp.Status)\" }}"
    );

    let output = powershell_hidden_command()
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("failed to run lockscreen command: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "no error output".to_string()
        };
        let lower = detail.to_ascii_lowercase();
        if lower.contains("getfilefrompathasync failed")
            || lower.contains("setimagefileasync failed")
            || lower.contains("access is denied")
            || lower.contains("unauthorized")
        {
            return Err(
                "잠금화면 설정이 Windows 권한/정책에 의해 차단되었습니다. Windows 설정에서 직접 변경해 주세요."
                    .to_string(),
            );
        }
        Err(format!(
            "lockscreen command exited with status {}: {}",
            output
                .status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            detail
        ))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_lockscreen_wallpaper(_path: String) -> Result<(), String> {
    Err("set_lockscreen_wallpaper is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_magick_image_count(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("file not found".to_string());
    }

    let api = magickwand_api(&app)?;
    let src_text = src.to_string_lossy().to_string();
    let src_c = CString::new(src_text).map_err(|_| "invalid path for MagickWand".to_string())?;

    unsafe {
        let wand = (api.new_magick_wand)();
        if wand.is_null() {
            return Err("NewMagickWand returned null".to_string());
        }

        let read_ok = (api.magick_read_image)(wand, src_c.as_ptr());
        if read_ok == 0 {
            let err = wand_exception_message(api, wand, "MagickReadImage failed");
            let _ = (api.destroy_magick_wand)(wand);
            return Err(err);
        }

        let count = (api.magick_get_number_images)(wand);
        let _ = (api.destroy_magick_wand)(wand);
        Ok(count.max(1))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_magick_image_count(_app: tauri::AppHandle, _path: String) -> Result<usize, String> {
    Err("get_magick_image_count is only supported on Windows".to_string())
}

#[tauri::command]
fn list_images_in_same_folder(path: String) -> Result<Vec<String>, String> {
    let current = std::path::PathBuf::from(&path);
    let dir = current
        .parent()
        .ok_or_else(|| "부모 폴더를 찾을 수 없습니다".to_string())?;

    let mut files = read_filtered_image_files(dir)?;

    #[cfg(target_os = "windows")]
    {
        sort_files_windows_with_cache(dir, &current, &mut files);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let sort_preference = detect_sort_preference_for_folder(dir);
        files.sort_by(|a, b| compare_with_preference(a, b, sort_preference));
    }

    Ok(files
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
fn get_folder_sort_debug(path: String) -> Result<FolderSortDebug, String> {
    let current = std::path::PathBuf::from(&path);
    let dir = current
        .parent()
        .ok_or_else(|| "부모 폴더를 찾을 수 없습니다".to_string())?;

    let filtered_files = read_filtered_image_files(dir)?;
    let sorted_files = list_images_in_same_folder(path.clone())?;

    #[cfg(target_os = "windows")]
    let input_key = normalize_windows_path_key(&path);
    #[cfg(not(target_os = "windows"))]
    let input_key = path.to_ascii_lowercase();

    #[cfg(target_os = "windows")]
    let folder_image_index = sorted_files
        .iter()
        .position(|p| normalize_windows_path_key(p) == input_key)
        .map(|idx| idx as isize)
        .unwrap_or(-1);
    #[cfg(not(target_os = "windows"))]
    let folder_image_index = sorted_files
        .iter()
        .position(|p| p.to_ascii_lowercase() == input_key)
        .map(|idx| idx as isize)
        .unwrap_or(-1);

    let first_sorted = sorted_files
        .iter()
        .take(6)
        .map(|p| file_name_only(p))
        .collect::<Vec<_>>();
    let first_filtered = filtered_files
        .iter()
        .take(6)
        .map(|p| file_name_only(&p.to_string_lossy()))
        .collect::<Vec<_>>();

    #[cfg(target_os = "windows")]
    {
        let ordered_paths = get_explorer_ordered_paths_for_folder(dir);
        let explorer_order_count = ordered_paths.as_ref().map(|v| v.len()).unwrap_or(0);
        let matched_window = has_explorer_window_for_folder(dir);
        let sort_columns_raw = get_explorer_sort_columns_raw_for_folder(dir).unwrap_or_default();
        let cached_entry = cached_entry_for_dir(dir);
        let dialog_names = last_dialog_order_names()
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();
        let dialog_order_count = dialog_names.len();
        let dialog_match = dialog_names_include_selected(&dialog_names, current.as_path());

        let matched_file_count = if let Some(ref ordered) = ordered_paths {
            let order_map: HashMap<String, usize> = ordered
                .iter()
                .enumerate()
                .map(|(idx, p)| (normalize_windows_path_key(p), idx))
                .collect();
            filtered_files
                .iter()
                .map(|p| normalize_windows_path_key(&p.to_string_lossy()))
                .filter(|k| order_map.contains_key(k))
                .count()
        } else {
            0
        };

        let source = if explorer_order_count > 0 {
            "explorer-order".to_string()
        } else if dialog_match {
            "file-dialog-order".to_string()
        } else if cached_entry
            .as_ref()
            .map(|e| !e.ordered_keys.is_empty())
            .unwrap_or(false)
        {
            "cache-order".to_string()
        } else if cached_entry.as_ref().and_then(|e| e.preference).is_some() {
            "cache-preference".to_string()
        } else if !sort_columns_raw.is_empty() {
            "sort-fallback".to_string()
        } else {
            "no-direct-order".to_string()
        };

        let note = if !matched_window {
            if dialog_match {
                "Explorer window not found, but file-dialog item order was applied.".to_string()
            } else if dialog_order_count > 0 {
                "File-dialog items were captured, but current filename did not match that list."
                    .to_string()
            } else {
                "Failed to read Explorer/file-dialog order for this folder.".to_string()
            }
        } else if explorer_order_count == 0 {
            "Explorer window matched, but item order could not be read.".to_string()
        } else if matched_file_count < filtered_files.len() {
            format!(
                "Explorer key mapping incomplete: {}/{}",
                matched_file_count,
                filtered_files.len()
            )
        } else {
            "Explorer order and key mapping succeeded.".to_string()
        };
        let note = if dialog_match {
            note
        } else {
            let scan_debug = last_dialog_scan_debug()
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();
            if scan_debug.is_empty() {
                note
            } else {
                format!("{note} | dialog-scan: {scan_debug}")
            }
        };
        let first_explorer = if let Some(paths) = ordered_paths {
            paths
                .into_iter()
                .take(6)
                .map(|p| file_name_only(&p))
                .collect::<Vec<_>>()
        } else {
            dialog_names.iter().take(6).cloned().collect::<Vec<_>>()
        };

        return Ok(FolderSortDebug {
            input_path: path,
            input_key,
            directory: dir.to_string_lossy().to_string(),
            source,
            matched_window,
            explorer_order_count,
            filtered_file_count: filtered_files.len(),
            matched_file_count,
            folder_image_index,
            sort_columns_raw,
            first_explorer,
            first_sorted,
            first_filtered,
            note,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(FolderSortDebug {
            input_path: path,
            input_key,
            directory: dir.to_string_lossy().to_string(),
            source: "non-windows".to_string(),
            matched_window: false,
            explorer_order_count: 0,
            filtered_file_count: filtered_files.len(),
            matched_file_count: 0,
            folder_image_index,
            sort_columns_raw: String::new(),
            first_explorer: Vec::new(),
            first_sorted,
            first_filtered,
            note: "Windows ?먯깋湲??뺣젹 ?붾쾭洹몃뒗 Windows?먯꽌留?吏?먮맗?덈떎.".to_string(),
        })
    }
}

fn file_name_only(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

#[derive(Clone, Copy)]
enum SortKey {
    Name,
    Date,
    Size,
}

#[derive(Clone, Copy)]
struct SortPreference {
    key: SortKey,
    descending: bool,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Default)]
struct FolderSortCacheEntry {
    ordered_keys: Vec<String>,
    preference: Option<SortPreference>,
}

#[cfg(target_os = "windows")]
static FOLDER_SORT_CACHE: OnceLock<Mutex<HashMap<String, FolderSortCacheEntry>>> = OnceLock::new();

#[cfg(target_os = "windows")]
static LAST_SORT_PREFERENCE: OnceLock<Mutex<Option<SortPreference>>> = OnceLock::new();
#[cfg(target_os = "windows")]
static LAST_DIALOG_ORDER_NAMES: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
#[cfg(target_os = "windows")]
static LAST_DIALOG_SCAN_DEBUG: OnceLock<Mutex<String>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn folder_sort_cache() -> &'static Mutex<HashMap<String, FolderSortCacheEntry>> {
    FOLDER_SORT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "windows")]
fn last_sort_preference() -> &'static Mutex<Option<SortPreference>> {
    LAST_SORT_PREFERENCE.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
fn last_dialog_order_names() -> &'static Mutex<Vec<String>> {
    LAST_DIALOG_ORDER_NAMES.get_or_init(|| Mutex::new(Vec::new()))
}

#[cfg(target_os = "windows")]
fn last_dialog_scan_debug() -> &'static Mutex<String> {
    LAST_DIALOG_SCAN_DEBUG.get_or_init(|| Mutex::new(String::new()))
}

#[cfg(target_os = "windows")]
struct SnapshotPoller {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

#[cfg(target_os = "windows")]
static SNAPSHOT_POLLER: OnceLock<Mutex<Option<SnapshotPoller>>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn snapshot_poller_state() -> &'static Mutex<Option<SnapshotPoller>> {
    SNAPSHOT_POLLER.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellSnapshotRow {
    path: String,
    #[serde(default)]
    sort_columns: String,
    #[serde(default)]
    items: Vec<String>,
}

fn compare_with_preference(
    a: &std::path::PathBuf,
    b: &std::path::PathBuf,
    preference: Option<SortPreference>,
) -> Ordering {
    let Some(pref) = preference else {
        return compare_paths_like_explorer(a, b);
    };

    let ord = match pref.key {
        SortKey::Name => compare_paths_like_explorer(a, b),
        SortKey::Date => {
            let a_time = file_time_key(a);
            let b_time = file_time_key(b);
            a_time
                .cmp(&b_time)
                .then_with(|| compare_paths_like_explorer(a, b))
        }
        SortKey::Size => {
            let a_size = file_size_key(a);
            let b_size = file_size_key(b);
            a_size
                .cmp(&b_size)
                .then_with(|| compare_paths_like_explorer(a, b))
        }
    };

    if pref.descending {
        ord.reverse()
    } else {
        ord
    }
}

#[cfg(target_os = "windows")]
fn sort_by_order_keys(files: &mut [std::path::PathBuf], ordered_keys: &[String]) {
    let order_map: HashMap<String, usize> = ordered_keys
        .iter()
        .enumerate()
        .map(|(idx, p)| (p.clone(), idx))
        .collect();

    files.sort_by(|a, b| {
        let a_key = normalize_windows_path_key(&a.to_string_lossy());
        let b_key = normalize_windows_path_key(&b.to_string_lossy());
        let a_idx = order_map.get(&a_key).copied().unwrap_or(usize::MAX);
        let b_idx = order_map.get(&b_key).copied().unwrap_or(usize::MAX);
        a_idx
            .cmp(&b_idx)
            .then_with(|| compare_paths_like_explorer(a, b))
    });
}

#[cfg(target_os = "windows")]
fn dir_cache_key(dir: &std::path::Path) -> String {
    normalize_windows_path_key(&dir.to_string_lossy())
}

#[cfg(target_os = "windows")]
fn cached_entry_for_dir(dir: &std::path::Path) -> Option<FolderSortCacheEntry> {
    let key = dir_cache_key(dir);
    let cache = folder_sort_cache().lock().ok()?;
    cache.get(&key).cloned()
}

#[cfg(target_os = "windows")]
fn normalize_file_name_key(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    std::path::Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(trimmed)
        .to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn file_stem_key_from_name(name: &str) -> String {
    std::path::Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn dialog_names_include_selected(dialog_names: &[String], selected_path: &std::path::Path) -> bool {
    let selected_name_key = selected_path
        .file_name()
        .and_then(|s| s.to_str())
        .map(normalize_file_name_key)
        .unwrap_or_default();
    if selected_name_key.is_empty() {
        return false;
    }

    if dialog_names
        .iter()
        .any(|name| normalize_file_name_key(name) == selected_name_key)
    {
        return true;
    }

    let selected_stem_key = selected_path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    !selected_stem_key.is_empty()
        && dialog_names
            .iter()
            .any(|name| file_stem_key_from_name(name) == selected_stem_key)
}

#[cfg(target_os = "windows")]
fn preview_names(items: &[String], limit: usize) -> String {
    items.iter()
        .take(limit)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(target_os = "windows")]
fn sort_by_dialog_name_order(files: &mut [std::path::PathBuf], dialog_names: &[String]) {
    let mut full_map = HashMap::<String, usize>::new();
    let mut stem_map = HashMap::<String, Option<usize>>::new();

    for (idx, name) in dialog_names.iter().enumerate() {
        let full = normalize_file_name_key(name);
        if !full.is_empty() {
            full_map.entry(full).or_insert(idx);
        }

        let stem = file_stem_key_from_name(name);
        if !stem.is_empty() {
            use std::collections::hash_map::Entry;
            match stem_map.entry(stem) {
                Entry::Vacant(v) => {
                    v.insert(Some(idx));
                }
                Entry::Occupied(mut o) => {
                    o.insert(None);
                }
            }
        }
    }

    files.sort_by(|a, b| {
        let a_name = a
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let b_name = b
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        let a_stem = a
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let b_stem = b
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        let a_idx = full_map
            .get(&a_name)
            .copied()
            .or_else(|| stem_map.get(&a_stem).and_then(|v| *v))
            .unwrap_or(usize::MAX);
        let b_idx = full_map
            .get(&b_name)
            .copied()
            .or_else(|| stem_map.get(&b_stem).and_then(|v| *v))
            .unwrap_or(usize::MAX);

        a_idx
            .cmp(&b_idx)
            .then_with(|| compare_paths_like_explorer(a, b))
    });
}

#[cfg(target_os = "windows")]
fn sort_files_windows_with_cache(
    dir: &std::path::Path,
    selected_path: &std::path::Path,
    files: &mut [std::path::PathBuf],
) {
    let key = dir_cache_key(dir);
    let dir_display = dir.to_string_lossy();
    let selected_display = selected_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();

    if let Ok(dialog_names_guard) = last_dialog_order_names().lock() {
        if !dialog_names_guard.is_empty()
            && dialog_names_include_selected(&dialog_names_guard, selected_path)
        {
            eprintln!(
                "[folder-sort] source=file-dialog dir=\"{}\" selected=\"{}\" count={} preview=[{}]",
                dir_display,
                selected_display,
                dialog_names_guard.len(),
                preview_names(&dialog_names_guard, 8)
            );
            sort_by_dialog_name_order(files, &dialog_names_guard);
            return;
        }
    }

    if let Some(ordered_paths) = get_explorer_ordered_paths_for_folder(dir) {
        let ordered_keys = ordered_paths
            .iter()
            .map(|p| normalize_windows_path_key(p))
            .collect::<Vec<_>>();
        eprintln!(
            "[folder-sort] source=explorer dir=\"{}\" selected=\"{}\" count={} preview=[{}]",
            dir_display,
            selected_display,
            ordered_keys.len(),
            preview_names(&ordered_keys, 8)
        );
        sort_by_order_keys(files, &ordered_keys);

        let preference = detect_sort_preference_for_folder(dir);
        if let Ok(mut cache) = folder_sort_cache().lock() {
            cache.insert(
                key.clone(),
                FolderSortCacheEntry {
                    ordered_keys,
                    preference,
                },
            );
        }
        if let Some(pref) = preference {
            if let Ok(mut last) = last_sort_preference().lock() {
                *last = Some(pref);
            }
        }
        return;
    }

    if let Ok(cache) = folder_sort_cache().lock() {
        if let Some(entry) = cache.get(&key) {
            if !entry.ordered_keys.is_empty() {
                eprintln!(
                    "[folder-sort] source=cache-order dir=\"{}\" selected=\"{}\" count={} preview=[{}]",
                    dir_display,
                    selected_display,
                    entry.ordered_keys.len(),
                    preview_names(&entry.ordered_keys, 8)
                );
                sort_by_order_keys(files, &entry.ordered_keys);
                return;
            }
            if entry.preference.is_some() {
                eprintln!(
                    "[folder-sort] source=cache-preference dir=\"{}\" selected=\"{}\"",
                    dir_display,
                    selected_display
                );
                files.sort_by(|a, b| compare_with_preference(a, b, entry.preference));
                return;
            }
        }
    }

    if let Some(preference) = detect_sort_preference_for_folder(dir) {
        eprintln!(
            "[folder-sort] source=sort-preference dir=\"{}\" selected=\"{}\"",
            dir_display,
            selected_display
        );
        files.sort_by(|a, b| compare_with_preference(a, b, Some(preference)));
        if let Ok(mut cache) = folder_sort_cache().lock() {
            cache.insert(
                key.clone(),
                FolderSortCacheEntry {
                    ordered_keys: Vec::new(),
                    preference: Some(preference),
                },
            );
        }
        if let Ok(mut last) = last_sort_preference().lock() {
            *last = Some(preference);
        }
        return;
    }

    // `read_dir()` iteration order is not stable. When Explorer metadata is
    // unavailable, fall back to the app's Explorer-like name sort so folder
    // navigation remains deterministic instead of appearing random.
    eprintln!(
        "[folder-sort] source=fallback-name dir=\"{}\" selected=\"{}\" count={}",
        dir_display,
        selected_display,
        files.len()
    );
    files.sort_by(compare_paths_like_explorer);
}

#[cfg(target_os = "windows")]
fn cache_shell_snapshot_rows(rows: Vec<ShellSnapshotRow>) {
    let mut last_seen_pref: Option<SortPreference> = None;
    let mut last_dialog_names: Option<Vec<String>> = None;
    if let Ok(mut cache) = folder_sort_cache().lock() {
        for row in rows {
            if row.path == "__dialog_items__" {
                let names = row
                    .items
                    .iter()
                    .map(|name| normalize_file_name_key(name))
                    .filter(|name| !name.is_empty())
                    .collect::<Vec<_>>();
                if !names.is_empty() {
                    last_dialog_names = Some(names);
                }
                continue;
            }

            let key = normalize_windows_path_key(&row.path);
            if key.is_empty() {
                continue;
            }

            let ordered_keys = row
                .items
                .iter()
                .map(|p| normalize_windows_path_key(p))
                .collect::<Vec<_>>();
            let preference = parse_sort_columns(row.sort_columns.trim());

            cache.insert(
                key,
                FolderSortCacheEntry {
                    ordered_keys,
                    preference,
                },
            );

            if preference.is_some() {
                last_seen_pref = preference;
            }
        }
    }

    if let Some(names) = last_dialog_names {
        eprintln!(
            "[dialog-snapshot] captured count={} preview=[{}]",
            names.len(),
            preview_names(&names, 8)
        );
        if let Ok(mut dialog_names) = last_dialog_order_names().lock() {
            *dialog_names = names;
        }
    } else {
        eprintln!("[dialog-snapshot] captured count=0");
    }

    if let Some(pref) = last_seen_pref {
        if let Ok(mut last) = last_sort_preference().lock() {
            *last = Some(pref);
        }
    }
}

#[cfg(target_os = "windows")]
fn parse_shell_snapshot_output(stdout: &str) -> Vec<ShellSnapshotRow> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if let Ok(rows) = serde_json::from_str::<Vec<ShellSnapshotRow>>(trimmed) {
        return rows;
    }
    if let Ok(row) = serde_json::from_str::<ShellSnapshotRow>(trimmed) {
        return vec![row];
    }
    Vec::new()
}

#[cfg(target_os = "windows")]
fn capture_shell_sort_cache_snapshot_impl() -> Result<(), String> {

    let script = r##"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
function Normalize-PathSafe([string]$p) {
  if (-not $p) { return "" }
  if ($p.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = '\\' + $p.Substring(8)
  } elseif ($p.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = $p.Substring(4)
  }
  try {
    return [System.IO.Path]::GetFullPath($p).TrimEnd('\','/')
  } catch {
    return $p.TrimEnd('\','/')
  }
}

$rows = @()

try {
  $shell = New-Object -ComObject Shell.Application
  foreach ($w in $shell.Windows()) {
    try {
      $p = $w.Document.Folder.Self.Path
      $pNorm = Normalize-PathSafe $p
      if (-not $pNorm) {
        try {
          $loc = $w.LocationURL
          if ($loc) {
            $u = [System.Uri]$loc
            $pNorm = Normalize-PathSafe ([System.Uri]::UnescapeDataString($u.LocalPath))
          }
        } catch {}
      }

      if (-not $pNorm) { continue }

      $sc = ""
      try { $sc = [string]$w.Document.SortColumns } catch {}

      $items = @()
      try {
        foreach ($item in $w.Document.Folder.Items()) {
          try {
            if (-not $item.IsFolder) { $items += [string]$item.Path }
          } catch {}
        }
      } catch {}

      $rows += [PSCustomObject]@{
        path = $pNorm
        sortColumns = $sc
        items = $items
      }
    } catch {}
  }
} catch {}

try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue | Out-Null
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction SilentlyContinue | Out-Null

  $root = [System.Windows.Automation.AutomationElement]::RootElement
$bestNames = @()
$scanMeta = @()
$candidateMeta = @()
$candidateCount = 0
$attempt = 1
$candidates = Collect-Candidates $root
$candidateCount = [int]$candidates.Count

foreach ($dlg in $candidates) {
  if ($null -eq $dlg) {
    $candidateMeta += "null"
    continue
  }

  $cls = Safe-GetString { $dlg.Current.ClassName } "-"
  $title = Safe-GetString { $dlg.Current.Name } "-"
  $pid = Safe-GetString { $dlg.Current.ProcessId } "-"
  $candidateMeta += "$cls|$pid|$title"

  $itemCond = New-Object System.Windows.Automation.OrCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::ListItem
    )),
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::DataItem
    ))
  )

  $nodes = $null
  try {
    $nodes = $dlg.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCond)
  } catch {}
  $nodeCount = if ($nodes) { [int]$nodes.Count } else { 0 }
  $scanMeta += "$cls|$pid|nodes=$nodeCount|$title"
  if (-not $nodes -or $nodeCount -le 0) { continue }

  $names = @()
  $seen = @{}
  foreach ($node in $nodes) {
    try {
      $n = [string]$node.Current.Name
      if ([string]::IsNullOrWhiteSpace($n)) { continue }
      $n = $n.Trim()
      if ($n -eq "." -or $n -eq "..") { continue }
      if ($n -match '^(Name|Modified|Date|Type|Size|?대쫫|?섏젙???좎쭨|?뺤떇|?ш린)$') { continue }
      if (-not $seen.ContainsKey($n)) {
        $seen[$n] = 1
        $names += $n
      }
    } catch {}
  }

  if ($names.Count -gt $bestNames.Count) {
    $bestNames = $names
  }
}
[PSCustomObject]@{
      path = "__dialog_items__"
      sortColumns = ""
      items = $bestNames
    }
  }
} catch {}

$rows | ConvertTo-Json -Depth 6 -Compress
"##;

    let output = powershell_hidden_command()
        .args([
            "-NoProfile",
            "-Sta",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|e| format!("powershell execution failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "powershell exited with status {}",
            output.status.code().unwrap_or(-1)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let rows = parse_shell_snapshot_output(&stdout);
    cache_shell_snapshot_rows(rows);
    Ok(())
}

#[cfg(target_os = "windows")]
fn capture_file_dialog_items_snapshot_impl() -> Result<bool, String> {

    let script = r##"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue | Out-Null
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction SilentlyContinue | Out-Null
} catch {}

function Safe-GetString([scriptblock]$sb, [string]$fallback = "") {
  try {
    $v = & $sb
    if ($null -eq $v) { return $fallback }
    return [string]$v
  } catch {
    return $fallback
  }
}

function Is-NoiseLabel([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $true }
  $t = $text.Trim()
  if ($t -eq "." -or $t -eq "..") { return $true }
  if ($t -match '^(Name|Modified|Date|Type|Size|Open|Cancel|File name:|File type:|파일 이름|파일 형식|열기|취소|새 폴더)$') { return $true }
  return $false
}

function Get-NodeLabel([System.Windows.Automation.AutomationElement]$node) {
  if ($null -eq $node) { return "" }

  $direct = Safe-GetString { $node.Current.Name }
  if (-not (Is-NoiseLabel $direct)) {
    return $direct.Trim()
  }

  try {
    $textCond = New-Object System.Windows.Automation.OrCondition(
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Text
      )),
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit
      ))
    )
    $texts = $node.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond)
    for ($j = 0; $j -lt $texts.Count; $j++) {
      $txt = Safe-GetString { $texts.Item($j).Current.Name }
      if (-not (Is-NoiseLabel $txt)) {
        return $txt.Trim()
      }
    }
  } catch {}

  return ""
}

function Collect-Candidates([System.Windows.Automation.AutomationElement]$root) {
  $list = New-Object System.Collections.ArrayList

  try {
    $dialogCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ClassNameProperty,
      "#32770"
    )
    $dialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $dialogCond)
    for ($i = 0; $i -lt $dialogs.Count; $i++) {
      $e = $dialogs.Item($i)
      if ($null -ne $e) { [void]$list.Add($e) }
    }
  } catch {}

  if ($list.Count -eq 0) {
    try {
      $winCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window
      )
      $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $winCond)
      for ($i = 0; $i -lt $wins.Count; $i++) {
        $w = $wins.Item($i)
        if ($null -eq $w) { continue }
        $title = Safe-GetString { $w.Current.Name }
        if ($title -match '?닿린|Open|Choose|Select') {
          [void]$list.Add($w)
        }
      }
    } catch {}
  }

  return $list
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$bestNames = @()
$scanMeta = @()
$candidateMeta = @()
$candidateCount = 0
$attempt = 1
$candidates = Collect-Candidates $root
$candidateCount = [int]$candidates.Count

foreach ($dlg in $candidates) {
  if ($null -eq $dlg) {
    $candidateMeta += "null"
    continue
  }

  $cls = Safe-GetString { $dlg.Current.ClassName } "-"
  $title = Safe-GetString { $dlg.Current.Name } "-"
  $pid = Safe-GetString { $dlg.Current.ProcessId } "-"
  $candidateMeta += "$cls|$pid|$title"

  $itemCond = New-Object System.Windows.Automation.OrCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::ListItem
    )),
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::DataItem
    ))
  )

  $nodes = $null
  try {
    $nodes = $dlg.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCond)
  } catch {}
  $nodeCount = if ($nodes) { [int]$nodes.Count } else { 0 }
  $scanMeta += "$cls|$pid|nodes=$nodeCount|$title"
  if (-not $nodes -or $nodeCount -le 0) { continue }

  $names = @()
  $seen = @{}
  foreach ($node in $nodes) {
    try {
      $n = Get-NodeLabel $node
      if ([string]::IsNullOrWhiteSpace($n)) { continue }
      if (-not $seen.ContainsKey($n)) {
        $seen[$n] = 1
        $names += $n
      }
    } catch {}
  }

  if ($names.Count -gt $bestNames.Count) {
    $bestNames = $names
  }
}
[PSCustomObject]@{
  names = @($bestNames)
  debug = [PSCustomObject]@{
    attempts = $attempt
    candidateCount = $candidateCount
    candidateMeta = @($candidateMeta)
    scanMeta = @($scanMeta)
    bestCount = [int]$bestNames.Count
  }
} | ConvertTo-Json -Depth 8 -Compress
"##;

    let output = powershell_hidden_command()
        .args([
            "-NoProfile",
            "-Sta",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|e| format!("powershell execution failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "powershell exited with status {}",
            output.status.code().unwrap_or(-1)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw = stdout.trim();
    if raw.is_empty() {
        if let Ok(mut dbg) = last_dialog_scan_debug().lock() {
            *dbg = "empty-output".to_string();
        }
        return Ok(false);
    }

    let mut names: Vec<String> = Vec::new();
    let mut scan_debug = String::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(arr) = value.get("names").and_then(|v| v.as_array()) {
            names = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect::<Vec<_>>();
        } else if let Some(s) = value.get("names").and_then(|v| v.as_str()) {
            names.push(s.to_string());
        } else if let Some(arr) = value.as_array() {
            names = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect::<Vec<_>>();
        } else if let Some(s) = value.as_str() {
            names.push(s.to_string());
        }

        if let Some(debug) = value.get("debug") {
            let candidate_count = debug
                .get("candidateCount")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let attempts = debug.get("attempts").and_then(|v| v.as_u64()).unwrap_or(0);
            let best_count = debug.get("bestCount").and_then(|v| v.as_u64()).unwrap_or(0);
            let candidate_meta = debug
                .get("candidateMeta")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .take(5)
                        .collect::<Vec<_>>()
                        .join(" || ")
                })
                .unwrap_or_default();
            let scan_meta = debug
                .get("scanMeta")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .take(5)
                        .collect::<Vec<_>>()
                        .join(" || ")
                })
                .unwrap_or_default();
            scan_debug = format!(
                "attempts={attempts}, candidates={candidate_count}, best={best_count}, windows=[{candidate_meta}], scans=[{scan_meta}]"
            );
        }
    }

    if scan_debug.is_empty() {
        scan_debug = "parse-no-debug".to_string();
    }
    if let Ok(mut dbg) = last_dialog_scan_debug().lock() {
        *dbg = scan_debug;
    }

    let normalized = names
        .iter()
        .map(|name| normalize_file_name_key(name))
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        return Ok(false);
    }

    if let Ok(mut dialog_names) = last_dialog_order_names().lock() {
        *dialog_names = normalized;
    }
    Ok(true)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn capture_shell_sort_cache_snapshot() -> Result<(), String> {
    capture_shell_sort_cache_snapshot_impl()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn start_shell_sort_snapshot_polling() -> Result<(), String> {
    let mut state = snapshot_poller_state()
        .lock()
        .map_err(|_| "poller lock poisoned".to_string())?;
    if state.is_some() {
        eprintln!("[dialog-poll] start ignored: already running");
        return Ok(());
    }

    if let Ok(mut dialog_names) = last_dialog_order_names().lock() {
        dialog_names.clear();
    }
    if let Ok(mut scan_debug) = last_dialog_scan_debug().lock() {
        scan_debug.clear();
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    eprintln!("[dialog-poll] start");
    let handle = thread::spawn(move || {
        while !stop_for_thread.load(AtomicOrdering::Relaxed) {
            match capture_file_dialog_items_snapshot_impl() {
                Ok(true) => {}
                Ok(false) => {
                    let scan_debug = last_dialog_scan_debug()
                        .lock()
                        .map(|g| g.clone())
                        .unwrap_or_default();
                    eprintln!("[dialog-poll] no-items debug={scan_debug}");
                }
                Err(err) => {
                    eprintln!("[dialog-poll] error={err}");
                }
            }
            thread::sleep(Duration::from_millis(120));
        }
        eprintln!("[dialog-poll] worker stopped");
    });

    *state = Some(SnapshotPoller {
        stop,
        handle: Some(handle),
    });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn stop_shell_sort_snapshot_polling() -> Result<(), String> {
    let poller = {
        let mut state = snapshot_poller_state()
            .lock()
            .map_err(|_| "poller lock poisoned".to_string())?;
        state.take()
    };

    if let Some(mut poller) = poller {
        poller.stop.store(true, AtomicOrdering::Relaxed);
        let _ = poller.handle.take();
        eprintln!("[dialog-poll] stop requested");
    } else {
        eprintln!("[dialog-poll] stop ignored: not running");
    }
    if let Ok(mut dialog_names) = last_dialog_order_names().lock() {
        dialog_names.clear();
    }
    if let Ok(mut scan_debug) = last_dialog_scan_debug().lock() {
        scan_debug.clear();
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn capture_shell_sort_cache_snapshot() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn start_shell_sort_snapshot_polling() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn stop_shell_sort_snapshot_polling() -> Result<(), String> {
    Ok(())
}

fn file_time_key(path: &std::path::Path) -> SystemTime {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn file_size_key(path: &std::path::Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn detect_sort_preference_for_folder(dir: &std::path::Path) -> Option<SortPreference> {

    let target = dir.to_string_lossy().to_string();
    let script = r#"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$target = $env:HOGUMA_TARGET_DIR
function Normalize-PathSafe([string]$p) {
  if (-not $p) { return "" }
  if ($p.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = '\\' + $p.Substring(8)
  } elseif ($p.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = $p.Substring(4)
  }
  try {
    return [System.IO.Path]::GetFullPath($p).TrimEnd('\','/')
  } catch {
    return $p.TrimEnd('\','/')
  }
}

$targetNorm = Normalize-PathSafe $target
$shell = New-Object -ComObject Shell.Application
foreach ($w in $shell.Windows()) {
  try {
    $p = $w.Document.Folder.Self.Path
    $pNorm = Normalize-PathSafe $p

    if (-not $pNorm) {
      try {
        $loc = $w.LocationURL
        if ($loc) {
          $u = [System.Uri]$loc
          $pNorm = Normalize-PathSafe ([System.Uri]::UnescapeDataString($u.LocalPath))
        }
      } catch {}
    }

    if ($pNorm -and [string]::Equals($pNorm, $targetNorm, [System.StringComparison]::OrdinalIgnoreCase)) {
      $sc = $w.Document.SortColumns
      if ($sc) { Write-Output $sc; break }
    }
  } catch {}
}
"#;

    let output = powershell_hidden_command()
        .env("HOGUMA_TARGET_DIR", target.as_str())
        .args([
            "-NoProfile",
            "-Sta",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    parse_sort_columns(raw.trim())
}

#[cfg(not(target_os = "windows"))]
fn detect_sort_preference_for_folder(_dir: &std::path::Path) -> Option<SortPreference> {
    None
}

#[cfg(target_os = "windows")]
fn has_explorer_window_for_folder(dir: &std::path::Path) -> bool {

    let target = dir.to_string_lossy().to_string();
    let script = r#"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$target = $env:HOGUMA_TARGET_DIR
function Normalize-PathSafe([string]$p) {
  if (-not $p) { return "" }
  if ($p.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = '\\' + $p.Substring(8)
  } elseif ($p.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = $p.Substring(4)
  }
  try { return [System.IO.Path]::GetFullPath($p).TrimEnd('\','/') } catch { return $p.TrimEnd('\','/') }
}
$targetNorm = Normalize-PathSafe $target
$shell = New-Object -ComObject Shell.Application
$found = 0
foreach ($w in $shell.Windows()) {
  try {
    $p = $w.Document.Folder.Self.Path
    $pNorm = Normalize-PathSafe $p
    if (-not $pNorm) {
      try {
        $loc = $w.LocationURL
        if ($loc) {
          $u = [System.Uri]$loc
          $pNorm = Normalize-PathSafe ([System.Uri]::UnescapeDataString($u.LocalPath))
        }
      } catch {}
    }
    if ($pNorm -and [string]::Equals($pNorm, $targetNorm, [System.StringComparison]::OrdinalIgnoreCase)) {
      $found = 1
      break
    }
  } catch {}
}
Write-Output $found
"#;

    let output = powershell_hidden_command()
        .env("HOGUMA_TARGET_DIR", target.as_str())
        .args([
            "-NoProfile",
            "-Sta",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output();

    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    raw.trim() == "1"
}

#[cfg(target_os = "windows")]
fn get_explorer_sort_columns_raw_for_folder(dir: &std::path::Path) -> Option<String> {

    let target = dir.to_string_lossy().to_string();
    let script = r#"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$target = $env:HOGUMA_TARGET_DIR
function Normalize-PathSafe([string]$p) {
  if (-not $p) { return "" }
  if ($p.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = '\\' + $p.Substring(8)
  } elseif ($p.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = $p.Substring(4)
  }
  try { return [System.IO.Path]::GetFullPath($p).TrimEnd('\','/') } catch { return $p.TrimEnd('\','/') }
}
$targetNorm = Normalize-PathSafe $target
$shell = New-Object -ComObject Shell.Application
foreach ($w in $shell.Windows()) {
  try {
    $p = $w.Document.Folder.Self.Path
    $pNorm = Normalize-PathSafe $p
    if (-not $pNorm) {
      try {
        $loc = $w.LocationURL
        if ($loc) {
          $u = [System.Uri]$loc
          $pNorm = Normalize-PathSafe ([System.Uri]::UnescapeDataString($u.LocalPath))
        }
      } catch {}
    }
    if ($pNorm -and [string]::Equals($pNorm, $targetNorm, [System.StringComparison]::OrdinalIgnoreCase)) {
      $sc = $w.Document.SortColumns
      if ($sc) { Write-Output $sc }
      break
    }
  } catch {}
}
"#;

    let output = powershell_hidden_command()
        .env("HOGUMA_TARGET_DIR", target.as_str())
        .args([
            "-NoProfile",
            "-Sta",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

fn parse_sort_columns(raw: &str) -> Option<SortPreference> {
    // Examples:
    // "prop:-System.ItemDate;"
    // "prop:System.ItemNameDisplay;"
    let value = raw.trim_start_matches('\u{feff}').strip_prefix("prop:")?;
    let first = value.split(';').next()?.trim();
    if first.is_empty() {
        return None;
    }

    let (descending, prop) = if let Some(rest) = first.strip_prefix('-') {
        (true, rest)
    } else {
        (false, first)
    };

    let key = match prop {
        "System.ItemDate" | "System.DateModified" | "System.DateCreated" => SortKey::Date,
        "System.Size" => SortKey::Size,
        "System.ItemNameDisplay" | "System.FileName" | "System.FileNameWithoutExtension" => {
            SortKey::Name
        }
        _ => SortKey::Name,
    };

    Some(SortPreference { key, descending })
}

#[cfg(target_os = "windows")]
fn get_explorer_ordered_paths_for_folder(dir: &std::path::Path) -> Option<Vec<String>> {

    let target = dir.to_string_lossy().to_string();
    let script = r#"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$target = $env:HOGUMA_TARGET_DIR
function Normalize-PathSafe([string]$p) {
  if (-not $p) { return "" }
  if ($p.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = '\\' + $p.Substring(8)
  } elseif ($p.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase)) {
    $p = $p.Substring(4)
  }
  try {
    return [System.IO.Path]::GetFullPath($p).TrimEnd('\','/')
  } catch {
    return $p.TrimEnd('\','/')
  }
}

$targetNorm = Normalize-PathSafe $target
$shell = New-Object -ComObject Shell.Application
foreach ($w in $shell.Windows()) {
  try {
    $p = $w.Document.Folder.Self.Path
    $pNorm = Normalize-PathSafe $p
    if (-not $pNorm) {
      try {
        $loc = $w.LocationURL
        if ($loc) {
          $u = [System.Uri]$loc
          $pNorm = Normalize-PathSafe ([System.Uri]::UnescapeDataString($u.LocalPath))
        }
      } catch {}
    }

    if ($pNorm -and [string]::Equals($pNorm, $targetNorm, [System.StringComparison]::OrdinalIgnoreCase)) {
      foreach ($item in $w.Document.Folder.Items()) {
        try {
          if (-not $item.IsFolder) {
            Write-Output $item.Path
          }
        } catch {}
      }
      break
    }
  } catch {}
}
"#;

    let output = powershell_hidden_command()
        .env("HOGUMA_TARGET_DIR", target.as_str())
        .args([
            "-NoProfile",
            "-Sta",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let rows: Vec<String> = stdout
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect();

    if rows.is_empty() {
        None
    } else {
        Some(rows)
    }
}

#[cfg(target_os = "windows")]
fn normalize_windows_path_key(path: &str) -> String {
    let mut p = path.replace('/', "\\");
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        p = format!(r"\\{}", rest);
    } else if let Some(rest) = p.strip_prefix(r"\\?\") {
        p = rest.to_string();
    }
    p.trim_end_matches(['\\', '/']).to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn compare_paths_like_explorer(a: &std::path::PathBuf, b: &std::path::PathBuf) -> Ordering {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    let a_name = a.file_name().unwrap_or_default();
    let b_name = b.file_name().unwrap_or_default();

    let a_wide: Vec<u16> = a_name.encode_wide().chain(once(0)).collect();
    let b_wide: Vec<u16> = b_name.encode_wide().chain(once(0)).collect();

    let cmp = unsafe { StrCmpLogicalW(a_wide.as_ptr(), b_wide.as_ptr()) };
    cmp.cmp(&0)
}

#[cfg(not(target_os = "windows"))]
fn compare_paths_like_explorer(a: &std::path::PathBuf, b: &std::path::PathBuf) -> Ordering {
    let a_name = a
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let b_name = b
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    a_name.cmp(&b_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_file_with_progress,
            read_image_file_bytes,
            read_text_file,
            get_launch_file_path,
            save_image_bytes,
            create_temp_backup_copy,
            remove_temp_file,
            copy_metadata_fast,
            save_edited_image_with_magick,
            log_decode_route,
            get_image_metadata,
            get_exif_details,
            is_hdr_jpeg,
            list_installed_font_families,
            delete_image_file,
            copy_file_to_clipboard,
            print_image_file,
            rotate_image_file,
            set_desktop_wallpaper,
            reveal_file_in_explorer,
            set_lockscreen_wallpaper,
            list_images_in_same_folder,
            get_folder_sort_debug,
            capture_shell_sort_cache_snapshot,
            start_shell_sort_snapshot_polling,
            stop_shell_sort_snapshot_polling,
            decode_with_magick,
            get_magick_image_count,
            get_or_create_vips_thumbnail
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent {
            ref label,
            event: tauri::WindowEvent::DragDrop(ref dnd_event),
            ..
        } = event
        {
            println!("[native-dnd] window={label} event={dnd_event:?}");
        }
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            clear_vips_thumbnail_cache_on_exit(app_handle);
        }
    });
}
