// Cup — a desktop home for the Pour package manager.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
// Free for personal use. Copying, modifying, rebranding or redistributing this
// code, in whole or in part, is not permitted. See LICENSE.
#![cfg_attr(windows, windows_subsystem = "windows")]

mod json;
mod pour;
mod sealed;

use json::{obj, q, Val};
use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicPtr, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

type Wv = *mut c_void;
type BindFn = extern "C" fn(*const c_char, *const c_char, *mut c_void);
type DispatchFn = extern "C" fn(Wv, *mut c_void);

extern "C" {
    fn webview_create(debug: c_int, window: *mut c_void) -> Wv;
    fn webview_destroy(w: Wv) -> c_int;
    fn webview_run(w: Wv) -> c_int;
    fn webview_terminate(w: Wv) -> c_int;
    fn webview_dispatch(w: Wv, f: DispatchFn, arg: *mut c_void) -> c_int;
    fn webview_set_title(w: Wv, t: *const c_char) -> c_int;
    fn webview_set_size(w: Wv, width: c_int, height: c_int, hints: c_int) -> c_int;
    fn webview_set_html(w: Wv, html: *const c_char) -> c_int;
    fn webview_init(w: Wv, js: *const c_char) -> c_int;
    fn webview_eval(w: Wv, js: *const c_char) -> c_int;
    fn webview_bind(w: Wv, name: *const c_char, f: BindFn, arg: *mut c_void) -> c_int;
    fn webview_return(w: Wv, id: *const c_char, status: c_int, result: *const c_char) -> c_int;
    fn cup_native_setup(w: Wv);
    fn cup_native_badge(label: *const c_char);
    fn cup_native_front(w: Wv);
}

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
static W: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static SEQ: AtomicU64 = AtomicU64::new(1);

type Slot = Arc<Mutex<Option<Child>>>;
type Jobs = Mutex<HashMap<String, Slot>>;

fn jobs() -> &'static Jobs {
    static J: OnceLock<Jobs> = OnceLock::new();
    J.get_or_init(Default::default)
}
fn armed() -> &'static Mutex<HashMap<String, Instant>> {
    static A: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    A.get_or_init(Default::default)
}

/// Runs JavaScript on the UI thread, from any thread.
fn post(js: String) {
    extern "C" fn run(w: Wv, arg: *mut c_void) {
        let s = unsafe { Box::from_raw(arg as *mut CString) };
        unsafe { webview_eval(w, s.as_ptr()) };
    }
    let w = W.load(Ordering::SeqCst);
    if w.is_null() {
        return;
    }
    if let Ok(c) = CString::new(js) {
        unsafe { webview_dispatch(w, run, Box::into_raw(Box::new(c)) as *mut c_void) };
    }
}

fn reply(id: &str, ok: bool, body: &str) {
    let w = W.load(Ordering::SeqCst);
    let (Ok(i), Ok(b)) = (CString::new(id), CString::new(body)) else {
        return;
    };
    unsafe { webview_return(w, i.as_ptr(), if ok { 0 } else { 1 }, b.as_ptr()) };
}

fn ev(job: &str, kind: &str, data: &str) {
    post(format!("window.__cupEv&&__cupEv({},{},{})", q(job), q(kind), q(data)));
}

/// Where Cup keeps its own small files.
fn data_dir() -> PathBuf {
    let h = pour::home();
    let d = if cfg!(target_os = "macos") {
        h.join("Library/Application Support/Cup")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or(h).join("Cup")
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| h.join(".config"))
            .join("cup")
    };
    let _ = std::fs::create_dir_all(&d);
    d
}

fn write_atomic(p: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = p.with_extension(format!("tmp{}", SEQ.fetch_add(1, Ordering::SeqCst)));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, p).or_else(|_| {
        let r = std::fs::write(p, bytes);
        let _ = std::fs::remove_file(&tmp);
        r
    })
}

/// A `sudo` that asks with a window instead of a terminal, for Pour's few password moments.
#[cfg(unix)]
fn sudo_shim() -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let real = ["/usr/bin/sudo", "/bin/sudo", "/usr/local/bin/sudo"]
        .into_iter()
        .find(|p| Path::new(p).exists())?;
    let dir = data_dir().join("shim");
    std::fs::create_dir_all(&dir).ok()?;
    let ask = dir.join("askpass");
    let ask_body = if cfg!(target_os = "macos") {
        "#!/bin/sh\nexec /usr/bin/osascript -e 'display dialog \"Pour needs your password to finish this step.\" with title \"Cup\" default answer \"\" with hidden answer with icon caution buttons {\"Cancel\",\"OK\"} default button \"OK\"' -e 'text returned of result'\n".to_string()
    } else {
        "#!/bin/sh\nfor t in zenity kdialog ssh-askpass; do command -v $t >/dev/null 2>&1 || continue\n case $t in zenity) exec zenity --password --title=Cup;; kdialog) exec kdialog --password 'Pour needs your password';; *) exec ssh-askpass 'Pour needs your password';; esac\ndone\nexit 1\n".to_string()
    };
    let shim = dir.join("sudo");
    let shim_body = format!("#!/bin/sh\nSUDO_ASKPASS='{}' exec {} -A \"$@\"\n", ask.display(), real);
    for (p, b) in [(&ask, ask_body), (&shim, shim_body)] {
        if std::fs::read_to_string(p).ok().as_deref() != Some(b.as_str()) {
            write_atomic(p, b.as_bytes()).ok()?;
        }
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700)).ok()?;
    }
    Some(dir)
}
#[cfg(not(unix))]
fn sudo_shim() -> Option<PathBuf> {
    None
}

fn command(prog: &Path, args: &[String]) -> Command {
    let mut c = Command::new(prog);
    c.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PATH", pour::child_path(sudo_shim().as_deref()))
        .env("NO_COLOR", "1")
        .env("POUR_SOUND", "0")
        .env("POUR_ANIMATIONS", "0")
        .env("POUR_FROM", "cup")
        .env_remove("CLICOLOR_FORCE");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // no console window
    }
    c
}

/// Starts a command and streams its lines to the page as `line`/`err` events, then `exit`.
fn stream(job: String, mut cmd: Command) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| format!("could not start: {e}"))?;
    let out = child.stdout.take();
    let err = child.stderr.take();
    let slot = Arc::new(Mutex::new(Some(child)));
    jobs().lock().unwrap().insert(job.clone(), slot.clone());
    let pump = |r: Option<Box<dyn Read + Send>>, kind: &'static str, job: String| {
        std::thread::spawn(move || {
            let Some(r) = r else { return };
            let mut buf = String::new();
            let mut last = Instant::now();
            // Progress bars rewrite one line with \r; keep only the last state of each.
            for line in BufReader::new(r).split(b'\n').map_while(Result::ok) {
                let text = String::from_utf8_lossy(&line);
                let text = text.rsplit('\r').find(|s| !s.trim().is_empty()).unwrap_or("").to_string();
                buf.push_str(&text);
                buf.push('\n');
                if last.elapsed() > Duration::from_millis(60) || buf.len() > 16_000 {
                    ev(&job, kind, &buf);
                    buf.clear();
                    last = Instant::now();
                }
            }
            if !buf.is_empty() {
                ev(&job, kind, &buf);
            }
        })
    };
    let a = pump(out.map(|o| Box::new(o) as Box<dyn Read + Send>), "line", job.clone());
    let b = pump(err.map(|o| Box::new(o) as Box<dyn Read + Send>), "err", job.clone());
    std::thread::spawn(move || {
        let code = loop {
            let mut g = slot.lock().unwrap();
            match g.as_mut().map(|c| c.try_wait()) {
                Some(Ok(Some(s))) => break s.code().unwrap_or(-1),
                Some(Ok(None)) => {}
                _ => break -1,
            }
            drop(g);
            std::thread::sleep(Duration::from_millis(40));
        };
        let _ = a.join();
        let _ = b.join();
        jobs().lock().unwrap().remove(&job);
        ev(&job, "exit", &code.to_string());
    });
    Ok(())
}

fn capture(mut cmd: Command) -> String {
    match cmd.output() {
        Ok(o) => obj(&[
            ("code", Val::N(o.status.code().unwrap_or(-1) as i64)),
            ("out", Val::S(String::from_utf8_lossy(&o.stdout).into_owned())),
            ("err", Val::S(String::from_utf8_lossy(&o.stderr).into_owned())),
        ]),
        Err(e) => obj(&[("code", Val::N(-1)), ("out", Val::S(String::new())), ("err", Val::S(e.to_string()))]),
    }
}

fn curl() -> PathBuf {
    if cfg!(windows) {
        let sys = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        let p = sys.join("System32").join("curl.exe");
        if p.exists() {
            return p;
        }
        return PathBuf::from("curl.exe");
    }
    ["/usr/bin/curl", "/bin/curl", "/usr/local/bin/curl"]
        .into_iter()
        .map(PathBuf::from)
        .find(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("curl"))
}

const HOSTS: &[&str] = &[
    "https://ipconfig.co.network/",
    "https://github.com/JKS-sys/",
    "https://api.github.com/repos/JKS-sys/",
];

/// GET with a disk cache: fresh copy within `max_age`, else download; old copy if offline.
fn fetch(url: &str, key: &str, max_age: u64) -> String {
    if !HOSTS.iter().any(|h| url.starts_with(h)) || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') || key.is_empty() {
        return obj(&[("ok", Val::B(false)), ("error", Val::S("address not allowed".into()))]);
    }
    let dir = data_dir().join("cache");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join(key);
    let age = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|d| d.as_secs());
    if let Some(a) = age {
        if a < max_age {
            if let Ok(t) = std::fs::read_to_string(&file) {
                return obj(&[("ok", Val::B(true)), ("text", Val::S(t)), ("age", Val::N(a as i64))]);
            }
        }
    }
    let tmp = dir.join(format!("{key}.part{}", SEQ.fetch_add(1, Ordering::SeqCst)));
    let mut c = Command::new(curl());
    c.args([
        "-fsSL",
        "--compressed",
        "-m",
        "90",
        "--retry",
        "2",
        "-A",
        &format!("Cup/{VERSION}"),
        "-o",
    ])
    .arg(&tmp)
    .arg(url)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let res = c.output();
    let good = matches!(&res, Ok(o) if o.status.success()) && std::fs::rename(&tmp, &file).is_ok();
    let _ = std::fs::remove_file(&tmp);
    match std::fs::read_to_string(&file) {
        Ok(t) => obj(&[
            ("ok", Val::B(true)),
            ("text", Val::S(t)),
            ("stale", Val::B(!good)),
            ("age", Val::N(if good { 0 } else { age.unwrap_or(0) as i64 })),
        ]),
        Err(_) => {
            let why = res
                .map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string())
                .unwrap_or_else(|e| e.to_string());
            obj(&[
                ("ok", Val::B(false)),
                ("error", Val::S(if why.is_empty() { "no answer".into() } else { why })),
            ])
        }
    }
}

fn open_url(target: &str) -> bool {
    let ok = target.starts_with("https://") || target.starts_with("http://") || Path::new(target).is_absolute();
    if !ok || target.chars().any(|c| c.is_control()) {
        return false;
    }
    let mut c = if cfg!(target_os = "macos") {
        let mut c = Command::new("/usr/bin/open");
        c.arg(target);
        c
    } else if cfg!(windows) {
        let mut c = Command::new("rundll32.exe");
        c.args(["url.dll,FileProtocolHandler", target]);
        c
    } else {
        let mut c = Command::new("xdg-open");
        c.arg(target);
        c
    };
    c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().is_ok()
}

/// Real on-disk size of a file or folder; symlinks are not followed.
fn dir_size(p: &Path) -> u64 {
    let Ok(m) = std::fs::symlink_metadata(p) else { return 0 };
    if m.is_dir() {
        std::fs::read_dir(p)
            .map(|r| r.filter_map(Result::ok).map(|e| dir_size(&e.path())).sum())
            .unwrap_or(0)
    } else if m.file_type().is_symlink() {
        0
    } else {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            m.blocks() * 512
        }
        #[cfg(not(unix))]
        {
            m.len()
        }
    }
}

/// The system clipboard (the WebView's own clipboard API is refused in an app window).
fn copy_text(t: &str) -> bool {
    use std::io::Write;
    let tries: &[(&str, &[&str])] = if cfg!(target_os = "macos") {
        &[("/usr/bin/pbcopy", &[])]
    } else if cfg!(windows) {
        &[("clip.exe", &[])]
    } else {
        &[
            ("wl-copy", &[]),
            ("xclip", &["-selection", "clipboard"]),
            ("xsel", &["--clipboard", "--input"]),
        ]
    };
    for (prog, args) in tries {
        let mut c = Command::new(prog);
        c.args(*args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000);
        }
        if let Ok(mut ch) = c.spawn() {
            if let Some(mut i) = ch.stdin.take() {
                let _ = i.write_all(t.as_bytes());
            }
            if ch.wait().is_ok_and(|s| s.success()) {
                return true;
            }
        }
    }
    false
}

fn safe_key(k: &str) -> bool {
    !k.is_empty() && k.len() < 64 && k.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn os_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "freebsd") {
        "freebsd"
    } else {
        "linux"
    }
}

fn env_json() -> String {
    let p = pour::find();
    obj(&[
        ("os", Val::S(os_name().into())),
        ("arch", Val::S(std::env::consts::ARCH.into())),
        ("pour", p.map(|p| Val::S(p.display().to_string())).unwrap_or(Val::Null)),
        ("home", Val::S(pour::home().display().to_string())),
        ("data", Val::S(data_dir().display().to_string())),
        ("version", Val::S(VERSION.into())),
        ("sep", Val::S(std::path::MAIN_SEPARATOR.to_string())),
    ])
}

/// Installs Pour itself with its official one-line installer (a fixed command).
fn install_pour(job: String) -> Result<(), String> {
    if cfg!(windows) {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| pour::home().join("AppData").join("Local"));
        let bin = base.join("Pour").join("bin");
        std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" };
        let url = format!("https://ipconfig.co.network/pour/dl/pour-windows-{arch}.exe");
        let mut c = command(
            &curl(),
            &[
                "-fSL".into(),
                "--retry".into(),
                "2".into(),
                "-o".into(),
                bin.join("pour.exe").display().to_string(),
                url,
            ],
        );
        c.env("POUR_PREFIX", base.join("Pour"));
        return stream(job, c);
    }
    let mut c = command(
        Path::new("/bin/sh"),
        &["-c".into(), "curl -fsSL https://ipconfig.co.network/pour/install | sh".into()],
    );
    c.env("POUR_FROM", "cup-install");
    stream(job, c)
}

fn handle(id: &str, req: &str) {
    let a = json::strings(req);
    let op = a.first().map(String::as_str).unwrap_or("");
    let arg = |i: usize| a.get(i).cloned().unwrap_or_default();
    match op {
        "env" => reply(id, true, &env_json()),
        "run" | "cap" => {
            let job = arg(1);
            let nonce = arg(2);
            let args: Vec<String> = a.iter().skip(3).cloned().collect();
            let risk = match pour::check(&args) {
                Ok(r) => r,
                Err(e) => return reply(id, false, &q(&e)),
            };
            if risk >= 2 {
                let ok = armed()
                    .lock()
                    .unwrap()
                    .remove(&nonce)
                    .is_some_and(|t| t.elapsed() < Duration::from_secs(120));
                if !ok {
                    return reply(id, false, &q("this step needs a confirmation first"));
                }
            }
            let Some(p) = pour::find() else {
                return reply(id, false, &q("Pour is not installed"));
            };
            let cmd = command(&p, &args);
            if op == "run" {
                match stream(job.clone(), cmd) {
                    Ok(()) => reply(id, true, &q(&job)),
                    Err(e) => reply(id, false, &q(&e)),
                }
            } else {
                let id = id.to_string();
                std::thread::spawn(move || reply(&id, true, &capture(cmd)));
            }
        }
        "arm" => {
            let n = format!("{:016x}", SEQ.fetch_add(1, Ordering::SeqCst) ^ sealed::noise());
            armed().lock().unwrap().insert(n.clone(), Instant::now());
            reply(id, true, &q(&n));
        }
        "kill" => {
            if let Some(s) = jobs().lock().unwrap().get(&arg(1)) {
                if let Some(c) = s.lock().unwrap().as_mut() {
                    let _ = c.kill();
                }
            }
            reply(id, true, "true");
        }
        "installpour" => match install_pour(arg(1)) {
            Ok(()) => reply(id, true, &q(&arg(1))),
            Err(e) => reply(id, false, &q(&e)),
        },
        "get" => {
            let (id, url, key, age) = (id.to_string(), arg(1), arg(2), arg(3).parse().unwrap_or(3600));
            std::thread::spawn(move || reply(&id, true, &fetch(&url, &key, age)));
        }
        "post" => {
            // Anonymous app pings and crash notes for the creator's dashboard; nothing else.
            let (id, path, body) = (id.to_string(), arg(1), arg(2));
            if !matches!(path.as_str(), "ping" | "crashes" | "apps/register") || body.len() > 64_000 {
                return reply(&id, false, &q("not allowed"));
            }
            std::thread::spawn(move || {
                let mut c = command(
                    &curl(),
                    &[
                        "-fsS".into(),
                        "-m".into(),
                        "20".into(),
                        "-X".into(),
                        "POST".into(),
                        "-H".into(),
                        "content-type: application/json".into(),
                        "--data-binary".into(),
                        "@-".into(),
                        format!("https://ipconfig.co.network/api/v1/{path}"),
                    ],
                );
                c.stdin(Stdio::piped());
                let ok = c.spawn().and_then(|mut ch| {
                    use std::io::Write;
                    if let Some(mut i) = ch.stdin.take() {
                        let _ = i.write_all(body.as_bytes());
                    }
                    ch.wait_with_output()
                });
                let out = ok.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
                reply(&id, true, &q(&out));
            });
        }
        "load" => {
            let k = arg(1);
            if !safe_key(&k) {
                return reply(id, false, &q("bad name"));
            }
            let t = std::fs::read_to_string(data_dir().join(format!("{k}.json"))).unwrap_or_default();
            reply(id, true, &q(&t));
        }
        "save" => {
            let k = arg(1);
            if !safe_key(&k) || arg(2).len() > 4_000_000 {
                return reply(id, false, &q("bad name"));
            }
            match write_atomic(&data_dir().join(format!("{k}.json")), arg(2).as_bytes()) {
                Ok(()) => reply(id, true, "true"),
                Err(e) => reply(id, false, &q(&e.to_string())),
            }
        }
        "list" => {
            // Saved snapshots (Brewfiles) in Cup's own folder.
            let dir = data_dir().join("snapshots");
            let _ = std::fs::create_dir_all(&dir);
            let mut v: Vec<(String, u64, u64)> = std::fs::read_dir(&dir)
                .map(|r| {
                    r.filter_map(Result::ok)
                        .filter_map(|e| {
                            let m = e.metadata().ok()?;
                            let t = m.modified().ok()?.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_secs();
                            Some((e.file_name().to_string_lossy().into_owned(), t, m.len()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            v.sort_by_key(|x| std::cmp::Reverse(x.1));
            let items: Vec<String> = v
                .iter()
                .map(|(n, t, s)| {
                    obj(&[
                        ("name", Val::S(n.clone())),
                        ("time", Val::N(*t as i64)),
                        ("size", Val::N(*s as i64)),
                    ])
                })
                .collect();
            reply(
                id,
                true,
                &obj(&[
                    ("dir", Val::S(dir.display().to_string())),
                    ("items", Val::R(format!("[{}]", items.join(",")))),
                ]),
            );
        }
        "readfile" => {
            let p = PathBuf::from(arg(1));
            let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !(name.contains("brewfile") || name.ends_with(".brewfile")) || arg(1).contains("..") {
                return reply(id, false, &q("Cup only opens Brewfiles"));
            }
            match std::fs::metadata(&p) {
                Ok(m) if m.len() < 2_000_000 => reply(id, true, &q(&std::fs::read_to_string(&p).unwrap_or_default())),
                _ => reply(id, false, &q("file not found")),
            }
        }
        "delsnap" => {
            let n = arg(1);
            if n.contains('/') || n.contains('\\') || n.contains("..") || n.is_empty() {
                return reply(id, false, &q("bad name"));
            }
            let _ = std::fs::remove_file(data_dir().join("snapshots").join(n));
            reply(id, true, "true");
        }
        "log" => {
            if std::env::var_os("CUP_DEBUG").is_some() {
                eprintln!("[page] {}", arg(1));
            }
            reply(id, true, "true");
        }
        "copy" => {
            let ok = copy_text(&arg(1));
            reply(id, true, if ok { "true" } else { "false" })
        }
        "du" => {
            // Sizes of installed packages, read only: each argument is "key|path|path…".
            let (id, items) = (id.to_string(), a.iter().skip(1).cloned().collect::<Vec<_>>());
            std::thread::spawn(move || {
                let parts: Vec<String> = items
                    .iter()
                    .filter_map(|it| {
                        let mut f = it.split('|');
                        let key = f.next()?.to_string();
                        let total: u64 = f
                            .filter(|p| Path::new(p).is_absolute() && !p.contains(".."))
                            .map(|p| dir_size(Path::new(p)))
                            .sum();
                        Some(format!("{}:{}", q(&key), total))
                    })
                    .collect();
                reply(&id, true, &format!("{{{}}}", parts.join(",")));
            });
        }
        "open" => reply(id, true, if open_url(&arg(1)) { "true" } else { "false" }),
        "badge" => {
            if let Ok(c) = CString::new(arg(1)) {
                unsafe { cup_native_badge(c.as_ptr()) };
            }
            reply(id, true, "true");
        }
        "title" => {
            if let Ok(c) = CString::new(arg(1)) {
                unsafe { webview_set_title(W.load(Ordering::SeqCst), c.as_ptr()) };
            }
            reply(id, true, "true");
        }
        "relaunch" => {
            // Start a fresh copy (after Pour replaced the app), then close this one.
            let ok = std::env::current_exe().ok().map(|exe| {
                let mut c = if cfg!(target_os = "macos") {
                    let bundle = exe
                        .ancestors()
                        .find(|p| p.extension().is_some_and(|e| e == "app"))
                        .map(Path::to_path_buf);
                    match bundle {
                        Some(b) => {
                            let mut c = Command::new("/usr/bin/open");
                            c.arg("-n").arg(b);
                            c
                        }
                        None => Command::new(&exe),
                    }
                } else {
                    Command::new(&exe)
                };
                c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().is_ok()
            });
            reply(id, true, if ok == Some(true) { "true" } else { "false" });
            if ok == Some(true) {
                unsafe { webview_terminate(W.load(Ordering::SeqCst)) };
            }
        }
        "quit" => {
            reply(id, true, "true");
            unsafe { webview_terminate(W.load(Ordering::SeqCst)) };
        }
        _ => reply(id, false, &q("unknown request")),
    }
}

extern "C" fn on_call(id: *const c_char, req: *const c_char, _arg: *mut c_void) {
    let id = unsafe { CStr::from_ptr(id) }.to_string_lossy().into_owned();
    let req = unsafe { CStr::from_ptr(req) }.to_string_lossy().into_owned();
    // A failure inside one request must never take the window down.
    let r = std::panic::catch_unwind(|| handle(&id, &req));
    if r.is_err() {
        reply(&id, false, &q("Cup hit an internal error"));
    }
}

#[no_mangle]
pub extern "C" fn cup_menu_cb(tag: c_int) {
    post(format!("window.__cupMenu&&__cupMenu({tag})"));
}

fn main() {
    if std::env::args().any(|a| a == "--version" || a == "-V") {
        println!("Cup {VERSION} — by Jagadeesh Kumar S");
        return;
    }
    let page = match sealed::page() {
        Some(p) => p,
        None => {
            eprintln!("Cup: this copy has been altered and will not start.");
            std::process::exit(3);
        }
    };
    let debug = std::env::var_os("CUP_DEBUG").is_some() as c_int;
    unsafe {
        let w = webview_create(debug, std::ptr::null_mut());
        if w.is_null() {
            eprintln!("Cup: could not open a window (is a WebView installed?)");
            std::process::exit(2);
        }
        W.store(w, Ordering::SeqCst);
        let title = CString::new("Cup").unwrap();
        webview_set_title(w, title.as_ptr());
        webview_set_size(w, 560, 420, 1);
        webview_set_size(w, 1180, 780, 0);
        cup_native_setup(w);
        let name = CString::new("__cup").unwrap();
        webview_bind(w, name.as_ptr(), on_call, std::ptr::null_mut());
        let boot = CString::new(format!("window.__CUP__={{v:{},os:{}}};", q(VERSION), q(os_name()))).unwrap();
        webview_init(w, boot.as_ptr());
        let html = CString::new(page).unwrap_or_default();
        webview_set_html(w, html.as_ptr());
        cup_native_front(w);
        webview_run(w);
        W.store(std::ptr::null_mut(), Ordering::SeqCst);
        for (_, s) in jobs().lock().unwrap().drain() {
            if let Some(c) = s.lock().unwrap().as_mut() {
                let _ = c.kill();
            }
        }
        webview_destroy(w);
    }
}

#[cfg(test)]
mod t {
    #[test]
    fn sizes_count_files_but_not_symlinks() {
        let d = std::env::temp_dir().join(format!("cup du test {}", std::process::id()));
        std::fs::create_dir_all(d.join("a b")).unwrap();
        std::fs::write(d.join("a b/f"), vec![1u8; 10_000]).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/usr", d.join("link")).unwrap();
        let n = super::dir_size(&d);
        assert!(n >= 10_000 && n < 1_000_000, "{n}");
        let _ = std::fs::remove_dir_all(&d);
    }
}
