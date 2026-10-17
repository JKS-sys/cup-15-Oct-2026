// Cup — line icons. Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
const D = {
  discover: 'M12 3l2.6 5.6L20 9.5l-4 4 1 5.8L12 16.5 7 19.3l1-5.8-4-4 5.4-.9z',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  tools: 'M4 6l6 6-6 6M12 18h8',
  installed: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  updates: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  leaves: 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7',
  taps: 'M8 3h8l-1 6h3v4H6V9h3zM12 13v8',
  bundle: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  care: 'M3 12h4l2-5 4 10 2-5h6',
  log: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1',
  about: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5v.5',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  copy: 'M9 9h10v11H9zM5 4h10v3M5 4v11h3',
  pin: 'M12 21v-7M8 3h8l-1 5 3 4H6l3-4z',
  stop: 'M7 7h10v10H7z',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19',
  moon: 'M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z',
  auto: 'M12 3a9 9 0 1 1 0 18zM12 3a9 9 0 0 0 0 18',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  star: 'M12 3l2.6 5.6L20 9.5l-4 4 1 5.8L12 16.5 7 19.3l1-5.8-4-4 5.4-.9z',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  layout: 'M4 4h16v16H4zM4 10h16M10 10v10',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 10a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  play: 'M7 5v14l12-7z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  cup: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M10 2c0 2-1 3-1 5',
  warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  key: 'M8 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM11 11h10M18 11v3M21 11v2',
};
export function Icon({ n, size = 18, cls = '' }) {
  return (
    <svg class={`ic ${cls}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={D[n] || D.more} />
    </svg>
  );
}
export const LOGO = (size = 64, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="cupg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0c35a"/><stop offset="1" stop-color="#c7891f"/></linearGradient></defs><path class="sp-stream" d="M64 4c0 14-6 20-6 34" fill="none" stroke="#3cc8e8" stroke-width="7" stroke-linecap="round"/><path class="sp-body" d="M24 46h62v26a26 26 0 0 1-26 26H50a26 26 0 0 1-26-26z" fill="url(#cupg)" stroke="#8a5a00" stroke-width="4"/><path class="sp-body" d="M86 54h8a12 12 0 0 1 0 24h-8" fill="none" stroke="#c7891f" stroke-width="7"/><path d="M30 52h50" stroke="#fff6dc" stroke-opacity=".7" stroke-width="4" stroke-linecap="round"/><path d="M34 108h42" stroke="#8a5a00" stroke-width="5" stroke-linecap="round"/></svg>`;
export function Logo({ size = 28 }) {
  return <span class="logo" dangerouslySetInnerHTML={{ __html: LOGO(size) }} />;
}
