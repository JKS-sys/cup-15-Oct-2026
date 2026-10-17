// Cup — tiny JSON helpers (the bridge only ever sends arrays of strings).
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved. See LICENSE.

/// Parses `["a","b",…]` into strings. Numbers, booleans and null become text.
pub fn strings(src: &str) -> Vec<String> {
    let b = src.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    let ws = |i: &mut usize| {
        while *i < b.len() && (b[*i] as char).is_ascii_whitespace() {
            *i += 1;
        }
    };
    ws(&mut i);
    if i >= b.len() || b[i] != b'[' {
        return out;
    }
    i += 1;
    loop {
        ws(&mut i);
        if i >= b.len() || b[i] == b']' {
            break;
        }
        if b[i] == b'"' {
            i += 1;
            let mut s: Vec<u8> = Vec::new();
            while i < b.len() && b[i] != b'"' {
                if b[i] == b'\\' && i + 1 < b.len() {
                    i += 1;
                    match b[i] {
                        b'n' => s.push(b'\n'),
                        b't' => s.push(b'\t'),
                        b'r' => s.push(b'\r'),
                        b'b' => s.push(8),
                        b'f' => s.push(12),
                        b'u' if i + 4 < b.len() => {
                            let hex = std::str::from_utf8(&b[i + 1..i + 5]).unwrap_or("0");
                            let mut cp = u32::from_str_radix(hex, 16).unwrap_or(0xfffd);
                            i += 4;
                            if (0xd800..0xdc00).contains(&cp) && i + 6 < b.len() && b[i + 1] == b'\\' && b[i + 2] == b'u' {
                                let lo = std::str::from_utf8(&b[i + 3..i + 7]).unwrap_or("0");
                                let lo = u32::from_str_radix(lo, 16).unwrap_or(0);
                                if (0xdc00..0xe000).contains(&lo) {
                                    cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                                    i += 6;
                                }
                            }
                            let c = char::from_u32(cp).unwrap_or('\u{fffd}');
                            let mut tmp = [0u8; 4];
                            s.extend_from_slice(c.encode_utf8(&mut tmp).as_bytes());
                        }
                        c => s.push(c),
                    }
                } else {
                    s.push(b[i]);
                }
                i += 1;
            }
            i += 1;
            out.push(String::from_utf8_lossy(&s).into_owned());
        } else {
            let st = i;
            while i < b.len() && b[i] != b',' && b[i] != b']' {
                i += 1;
            }
            out.push(String::from_utf8_lossy(&b[st..i]).trim().to_string());
        }
        ws(&mut i);
        if i < b.len() && b[i] == b',' {
            i += 1;
        }
    }
    out
}

/// A JSON string literal.
pub fn q(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            // Keeps the text safe inside a <script> and inside eval().
            '<' => o.push_str("\\u003c"),
            '\u{2028}' => o.push_str("\\u2028"),
            '\u{2029}' => o.push_str("\\u2029"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// `{"k":"v",…}` from pairs; values that start with `{`, `[`, a digit, `-`, `t`, `f` or `n`
/// and are marked raw go in as they are.
pub fn obj(pairs: &[(&str, Val)]) -> String {
    let mut o = String::from("{");
    for (n, (k, v)) in pairs.iter().enumerate() {
        if n > 0 {
            o.push(',');
        }
        o.push_str(&q(k));
        o.push(':');
        match v {
            Val::S(s) => o.push_str(&q(s)),
            Val::R(r) => o.push_str(r),
            Val::N(n) => o.push_str(&n.to_string()),
            Val::B(b) => o.push_str(if *b { "true" } else { "false" }),
            Val::Null => o.push_str("null"),
        }
    }
    o.push('}');
    o
}

pub enum Val {
    S(String),
    R(String),
    N(i64),
    B(bool),
    Null,
}

#[cfg(test)]
mod t {
    use super::*;
    #[test]
    fn parses() {
        assert_eq!(
            strings(r#"["run","j1","install","--cask","x"]"#),
            vec!["run", "j1", "install", "--cask", "x"]
        );
        assert_eq!(strings(r#"[ "a\"b" , 3, true ]"#), vec!["a\"b", "3", "true"]);
        assert_eq!(strings(r#"["é😀"]"#), vec!["é😀"]);
        assert!(strings("{}").is_empty());
    }
    #[test]
    fn quotes() {
        assert_eq!(q("a\"<\n"), format!("\"a\\\"{}003c\\n\"", "\\u"));
        assert_eq!(
            obj(&[("a", Val::N(1)), ("b", Val::S("x".into())), ("c", Val::Null)]),
            r#"{"a":1,"b":"x","c":null}"#
        );
    }
}
