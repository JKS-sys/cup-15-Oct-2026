// Cup — every command Cup may give Pour, checked here before anything runs.
// The page names a Pour sub-command and its arguments; this file decides whether
// that exact command is allowed (no shell is ever involved) and how risky it is.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved. See LICENSE.

use std::path::{Path, PathBuf};

/// (sub-command, flags it may carry, flags that take a value, risk 0–3)
type Rule = (&'static str, &'static [&'static str], &'static [&'static str], u8);

const RULES: &[Rule] = &[
    (
        "install",
        &[
            "--formula",
            "--cask",
            "--reinstall",
            "--only-dependencies",
            "--skip-post-install",
            "--overwrite",
            "--force",
            "-f",
            "--dry-run",
            "-n",
        ],
        &["-j", "--jobs"],
        0,
    ),
    ("uninstall", &["--formula", "--cask", "--ignore-dependencies", "--zap"], &[], 1),
    ("reinstall", &["--formula", "--cask"], &[], 0),
    ("upgrade", &["--formula", "--cask", "--greedy", "--dry-run", "-n"], &[], 0),
    ("update", &["--force", "-f"], &[], 0),
    ("outdated", &["--formula", "--cask"], &[], 0),
    ("search", &["--formula", "--cask"], &["--limit"], 0),
    ("info", &["--formula", "--cask"], &[], 0),
    ("list", &["--formula", "--cask", "--versions", "-l"], &[], 0),
    ("link", &["--overwrite"], &[], 0),
    ("unlink", &[], &[], 0),
    ("pin", &[], &[], 0),
    ("unpin", &[], &[], 0),
    ("deps", &["--tree", "--installed"], &[], 0),
    ("uses", &[], &[], 0),
    ("leaves", &[], &[], 0),
    ("apps", &[], &[], 0),
    ("doctor", &[], &[], 0),
    ("cleanup", &["--dry-run", "-n"], &[], 1),
    ("tap", &[], &[], 0),
    ("bundle", &["--dry-run", "-n", "--force"], &["--file", "-f"], 1),
    ("migrate", &["--dry-run", "-n"], &[], 2),
    ("env", &[], &[], 0),
    ("self-update", &["--check"], &[], 0),
    ("--version", &[], &[], 0),
];

/// Flags every Pour command takes.
const GLOBAL: &[&str] = &["--json", "--quiet", "-q", "--verbose", "-v"];

fn name_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 120
        && !s.starts_with('-')
        && !s.contains("..")
        && s.bytes().all(|c| c.is_ascii_alphanumeric() || b"@+._/-".contains(&c))
}

fn url_ok(s: &str) -> bool {
    s.starts_with("https://") && s.len() < 400 && !s.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn path_ok(s: &str) -> bool {
    !s.is_empty() && s.len() < 1024 && !s.chars().any(|c| c.is_control())
}

/// Checks a Pour command line. Returns its risk (0–3) or the reason it was refused.
pub fn check(args: &[String]) -> Result<u8, String> {
    let sub = args.first().ok_or("no command")?.as_str();
    let rule = RULES
        .iter()
        .find(|r| r.0 == sub)
        .ok_or_else(|| format!("Cup does not run `pour {sub}`"))?;
    let mut risk = rule.3;
    let rest = &args[1..];
    // Sub-actions with their own shape.
    if sub == "tap" {
        return match rest.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
            [] | ["list"] => Ok(0),
            ["add", n, u] if name_ok(n) && url_ok(u) => Ok(1),
            ["remove", n] if name_ok(n) => Ok(1),
            _ => Err("a tap needs a name and an https:// address".into()),
        };
    }
    let mut i = if sub == "bundle" {
        match rest.first().map(String::as_str) {
            Some("install") | Some("dump") => 1,
            _ => return Err("bundle needs install or dump".into()),
        }
    } else {
        0
    };
    let mut names = 0;
    while i < rest.len() {
        let a = rest[i].as_str();
        if a.starts_with('-') {
            if GLOBAL.contains(&a) {
                i += 1;
                continue;
            }
            if rule.2.contains(&a) {
                let v = rest.get(i + 1).ok_or_else(|| format!("{a} needs a value"))?;
                let good = match a {
                    "--file" | "-f" => path_ok(v),
                    _ => !v.is_empty() && v.len() < 6 && v.bytes().all(|c| c.is_ascii_digit()),
                };
                if !good {
                    return Err(format!("{a}: not an allowed value"));
                }
                i += 2;
                continue;
            }
            if !rule.1.contains(&a) {
                return Err(format!("`{a}` is not allowed with pour {sub}"));
            }
            if a == "--zap" || a == "--ignore-dependencies" || a == "--force" && sub == "bundle" {
                risk = risk.max(2);
            }
            if (a == "--dry-run" || a == "-n") && sub != "install" {
                risk = 0;
            }
        } else {
            if sub == "search" {
                if a.len() > 80 || a.chars().any(|c| c.is_control()) {
                    return Err("search words are too long".into());
                }
            } else if !name_ok(a) {
                return Err(format!("`{a}` is not a package name"));
            }
            names += 1;
        }
        i += 1;
    }
    let needs_names = matches!(
        sub,
        "install" | "uninstall" | "reinstall" | "info" | "link" | "unlink" | "pin" | "unpin" | "deps" | "uses" | "search"
    );
    if needs_names && names == 0 {
        return Err(format!("pour {sub} needs at least one name"));
    }
    if names > 400 {
        return Err("too many names at once".into());
    }
    Ok(risk)
}

pub fn exe_name() -> &'static str {
    if cfg!(windows) {
        "pour.exe"
    } else {
        "pour"
    }
}

pub fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Folders Pour may live in, best first. A Dock-launched app has almost no PATH,
/// so the usual places are checked by hand.
pub fn bin_dirs() -> Vec<PathBuf> {
    let h = home();
    let mut v = Vec::new();
    if let Some(p) = std::env::var_os("POUR_PREFIX") {
        v.push(PathBuf::from(p).join("bin"));
    }
    if cfg!(windows) {
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            v.push(PathBuf::from(l).join("Pour").join("bin"));
        }
        v.push(h.join("AppData").join("Local").join("Pour").join("bin"));
    } else {
        v.push(PathBuf::from("/opt/pour/bin"));
        v.push(h.join(".pour/bin"));
        v.push(PathBuf::from("/usr/local/pour/bin"));
        v.push(h.join("config/non-packaged/pour/bin"));
        v.push(h.join(".local/bin"));
        v.push(h.join("bin"));
        v.push(PathBuf::from("/usr/local/bin"));
    }
    if let Some(p) = std::env::var_os("PATH") {
        v.extend(std::env::split_paths(&p));
    }
    v
}

pub fn find() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("CUP_POUR") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    bin_dirs().into_iter().map(|d| d.join(exe_name())).find(|p| p.is_file())
}

/// PATH for every child: Pour's folders, Cup's sudo shim, the system folders, then the rest.
pub fn child_path(shim: Option<&Path>) -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(s) = shim {
        dirs.push(s.to_path_buf());
    }
    if let Some(p) = find() {
        if let Some(d) = p.parent() {
            dirs.push(d.to_path_buf());
            if let Some(pre) = d.parent() {
                dirs.push(pre.join("sbin"));
            }
        }
    }
    if !cfg!(windows) {
        for d in ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            dirs.push(PathBuf::from(d));
        }
    }
    if let Some(p) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&p));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    std::env::join_paths(dirs).unwrap_or_default()
}

#[cfg(test)]
mod t {
    use super::*;
    fn v(s: &str) -> Vec<String> {
        s.split(' ').map(String::from).collect()
    }
    #[test]
    fn allows_the_usual() {
        assert_eq!(check(&v("install --cask firefox")), Ok(0));
        assert_eq!(check(&v("install jq wget -j 8")), Ok(0));
        assert_eq!(check(&v("uninstall --cask --zap firefox")), Ok(2));
        assert_eq!(check(&v("cleanup --dry-run")), Ok(0));
        assert_eq!(check(&v("cleanup")), Ok(1));
        assert_eq!(check(&v("migrate")), Ok(2));
        assert_eq!(check(&v("migrate -n")), Ok(0));
        assert_eq!(check(&v("tap add me/x https://e.com/i.json")), Ok(1));
        assert_eq!(check(&v("bundle dump --file /tmp/Brewfile --force")), Ok(2));
        assert_eq!(check(&v("search json parser")), Ok(0));
        assert_eq!(check(&v("--version")), Ok(0));
        assert_eq!(check(&v("list --json")), Ok(0));
        assert_eq!(check(&v("info --cask firefox --json")), Ok(0));
    }
    #[test]
    fn refuses_the_rest() {
        assert!(check(&v("install")).is_err());
        assert!(check(&v("install --evil x")).is_err());
        assert!(check(&v("install ../../x")).is_err());
        assert!(check(&v("init")).is_err());
        assert!(check(&v("registry import x")).is_err());
        assert!(check(&v("tap add me/x http://e.com")).is_err());
        assert!(check(&v("install -j 99999999 x")).is_err());
        assert!(check(&v("bundle")).is_err());
        assert!(check(&[]).is_err());
    }
}
