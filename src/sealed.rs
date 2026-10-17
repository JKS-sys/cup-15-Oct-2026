// Cup — the interface ships sealed inside the program: compressed, scrambled with a
// key derived from its owner's name and checked before it is shown. A copy whose
// interface or byline was changed refuses to start.
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved. See LICENSE.

include!(concat!(env!("OUT_DIR"), "/seal.rs"));

const OWNER: &str = "Jagadeesh Kumar S";

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

pub fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

/// The page, or None when this copy was tampered with.
pub fn page() -> Option<String> {
    let seed = fnv(OWNER.as_bytes()) ^ SALT;
    let mut k = stream(seed);
    let raw: Vec<u8> = BLOB.iter().map(|b| b ^ k()).collect();
    let plain = miniz_oxide::inflate::decompress_to_vec(&raw).ok()?;
    if fnv(&plain) != CHECK || plain.len() != LEN {
        return None;
    }
    let s = String::from_utf8(plain).ok()?;
    s.contains(OWNER).then_some(s)
}

/// A little unpredictability for one-time confirmation codes.
pub fn noise() -> u64 {
    // macOS clocks tick in microseconds, so two calls in a row can see the same time:
    // a counter keeps every value different.
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = N
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        .wrapping_mul(0x9e37_79b9_7f4a_7c15);
    let t = n ^ std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(7);
    let mut k = stream(t ^ SALT ^ (std::process::id() as u64) << 32);
    (0..8).fold(0u64, |a, _| a << 8 | k() as u64)
}

#[cfg(test)]
mod t {
    #[test]
    fn opens_and_carries_its_byline() {
        let p = super::page().expect("the sealed interface opens");
        assert!(p.contains("By Jagadeesh Kumar S") || p.contains("Jagadeesh Kumar S"));
        assert_ne!(super::noise(), super::noise());
    }
}
