// Cup build: compiles the WebView glue and seals the interface into the program.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved. See LICENSE.
use std::path::PathBuf;

const OWNER: &str = "Jagadeesh Kumar S";

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

fn stream(seed: u64) -> impl FnMut() -> u8 {
    let mut s = seed | 1;
    let mut buf = 0u64;
    let mut n = 0;
    move || {
        if n == 0 {
            s ^= s >> 12;
            s ^= s << 25;
            s ^= s >> 27;
            buf = s.wrapping_mul(0x2545_f491_4f6c_dd1d);
            n = 8;
        }
        n -= 1;
        let b = buf as u8;
        buf >>= 8;
        b
    }
}

fn main() {
    let target = std::env::var("TARGET").unwrap();
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    println!("cargo:rerun-if-changed=src/native.cc");
    println!("cargo:rerun-if-changed=ui/dist/index.html");
    println!("cargo:rerun-if-env-changed=CUP_SALT");

    // 1. The interface: built by `npm run build` in ui/ into one file.
    let page = std::fs::read("ui/dist/index.html")
        .unwrap_or_else(|_| panic!("ui/dist/index.html is missing — run `npm ci && npm run build` in ui/ first (update.sh does this)"));
    assert!(
        std::str::from_utf8(&page).map(|s| s.contains(OWNER)).unwrap_or(false),
        "the interface must carry its owner's byline"
    );
    let packed = miniz_oxide::deflate::compress_to_vec(&page, 10);
    let salt: u64 = std::env::var("CUP_SALT").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        fnv(&t.to_le_bytes()) ^ fnv(&page)
    });
    let mut k = stream(fnv(OWNER.as_bytes()) ^ salt);
    let sealed: Vec<u8> = packed.iter().map(|b| b ^ k()).collect();
    std::fs::write(out.join("ui.bin"), &sealed).unwrap();
    std::fs::write(
        out.join("seal.rs"),
        format!(
            "const BLOB: &[u8] = include_bytes!(concat!(env!(\"OUT_DIR\"), \"/ui.bin\"));\nconst SALT: u64 = {salt};\nconst CHECK: u64 = {};\nconst LEN: usize = {};\n",
            fnv(&page),
            page.len()
        ),
    )
    .unwrap();

    // 2. The native glue around the system WebView.
    let mut b = cc::Build::new();
    let mut after: Vec<&str> = Vec::new();
    let mut linux_libs: Vec<String> = Vec::new();
    b.cpp(true)
        .file("src/native.cc")
        .include("vendor/webview/include")
        .define("WEBVIEW_STATIC", None)
        .warnings(false);
    if target.contains("msvc") {
        b.flag("/std:c++17").flag("/EHsc").flag("/O1").flag("/utf-8");
    } else {
        b.flag("-std=c++17")
            .flag("-Os")
            .flag("-fvisibility=hidden")
            .flag("-ffunction-sections")
            .flag("-fdata-sections");
    }
    if target.contains("windows") {
        b.include("vendor/webview2")
            .define("WEBVIEW_EDGE", None)
            .define("UNICODE", None)
            .define("_UNICODE", None);
        if target.contains("gnu") {
            b.cpp_link_stdlib(None);
            after.push("static=stdc++");
        }
        for l in ["advapi32", "ole32", "shell32", "shlwapi", "user32", "version", "dwmapi", "gdi32"] {
            after.push(l);
        }
        let _ = embed_resource::compile("assets/cup.rc", embed_resource::NONE);
    } else if target.contains("apple") {
        b.define("WEBVIEW_COCOA", None).flag("-mmacosx-version-min=11.0");
        println!("cargo:rustc-link-lib=framework=WebKit");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=c++");
        // `__builtin_available` in the WebKit glue calls ___isPlatformVersionAtLeast, which lives in
        // clang's own runtime library. rustc links with -nodefaultlibs, so name that library here.
        let cc = b.get_compiler();
        let dir = std::process::Command::new(cc.path())
            .arg("--print-resource-dir")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        let rt = std::path::Path::new(&dir).join("lib/darwin/libclang_rt.osx.a");
        if rt.exists() {
            println!("cargo:rustc-link-arg={}", rt.display());
        } else {
            println!("cargo:warning=libclang_rt.osx.a not found under {dir:?}; the link may fail");
        }
    } else {
        b.define("WEBVIEW_GTK", None);
        // Probe without emitting, so the libraries are named after the glue (order matters to ld).
        let probe = |n: &str| {
            pkg_config::Config::new()
                .cargo_metadata(false)
                .probe(n)
                .unwrap_or_else(|e| panic!("{n} development files are missing: {e}"))
        };
        for lib in [probe("webkit2gtk-4.1"), probe("gtk+-3.0")] {
            // A sysroot's own usr/include must stay last (libc++ relies on that order).
            for p in lib.include_paths.iter().filter(|p| !p.ends_with("usr/include")) {
                b.include(p);
            }
            for p in &lib.link_paths {
                println!("cargo:rustc-link-search=native={}", p.display());
            }
            for l in lib.libs {
                linux_libs.push(l);
            }
        }
    }
    b.compile("cupnative");
    // System libraries come after the glue so the linker can resolve it.
    for l in after {
        println!("cargo:rustc-link-lib={l}");
    }
    let mut seen = std::collections::HashSet::new();
    for l in linux_libs {
        if seen.insert(l.clone()) {
            println!("cargo:rustc-link-lib={l}");
        }
    }
}
