// v0.8.50: Icones SVG extraidos do LudexLauncher.jsx pra reduzir tamanho do
// arquivo principal (~130L). Stateless, sem props alem de optional { id, filled }.
// Regra: sem emojis em UI (vide memoria Paulo). Sempre aria-hidden em decorativo.

import React from "react";

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
export function CloseIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>); }
export function PowerIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>); }
export function FullscreenIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /></svg>); }
export function RefreshIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-3.51-7.13" /><polyline points="21 4 21 10 15 10" /></svg>); }
export function PlusIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>); }
export function TrashIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>); }
export function EditIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>); }
export function RotateIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>); }
export function UserIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>); }
export function SearchIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>); }
export function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
export function PlayIcon() { return (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="6 4 20 12 6 20 6 4" /></svg>); }
export function FolderIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>); }
export function InfoIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>); }
export function SpeakerIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>); }
export function SpeakerMuteIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>); }
export function CheckIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>); }
export function ShieldIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>); }
export function SortIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="9" y2="18" /></svg>); }
export function ImageIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>); }
export function GamepadIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="6" y1="11" x2="10" y2="11" /><line x1="8" y1="9" x2="8" y2="13" /><line x1="15" y1="12" x2="15.01" y2="12" /><line x1="18" y1="10" x2="18.01" y2="10" /><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z" /></svg>); }

export function SystemIcon({ id }) {
  const fill = "currentColor";
  switch (id) {
    case "switch":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="8" width="20" height="48" rx="9" fill={fill} /><rect x="38" y="8" width="20" height="48" rx="9" fill={fill} /><circle cx="16" cy="20" r="3" fill="#1c1c1c" /><circle cx="48" cy="44" r="3" fill="#1c1c1c" /><circle cx="16" cy="36" r="1.6" fill="#1c1c1c" /><circle cx="13" cy="40" r="1.2" fill="#1c1c1c" /><circle cx="19" cy="40" r="1.2" fill="#1c1c1c" /><circle cx="16" cy="44" r="1.2" fill="#1c1c1c" /><circle cx="48" cy="20" r="1.2" fill="#1c1c1c" /><circle cx="44" cy="24" r="1.2" fill="#1c1c1c" /><circle cx="52" cy="24" r="1.2" fill="#1c1c1c" /><circle cx="48" cy="28" r="1.2" fill="#1c1c1c" /></svg>);
    case "wiiu":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="14" width="56" height="36" rx="8" fill={fill} /><rect x="14" y="22" width="36" height="20" rx="2" fill="#1c1c1c" /><circle cx="9" cy="32" r="2" fill="#1c1c1c" /><circle cx="55" cy="32" r="2" fill="#1c1c1c" /></svg>);
    case "3ds":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="10" y="6" width="44" height="22" rx="3" fill={fill} /><rect x="14" y="10" width="36" height="14" rx="1" fill="#1c1c1c" /><rect x="10" y="32" width="44" height="26" rx="3" fill={fill} /><rect x="14" y="36" width="22" height="16" rx="1" fill="#1c1c1c" /><circle cx="44" cy="40" r="2" fill="#1c1c1c" /><circle cx="50" cy="40" r="2" fill="#1c1c1c" /><circle cx="44" cy="46" r="2" fill="#1c1c1c" /><circle cx="50" cy="46" r="2" fill="#1c1c1c" /><text x="32" y="55" textAnchor="middle" fill={fill} fontSize="6" fontWeight="700" fontFamily="system-ui">3DS</text></svg>);
    case "wii":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="24" y="6" width="16" height="52" rx="4" fill={fill} /><circle cx="32" cy="14" r="3" fill="#1c1c1c" /><rect x="28" y="22" width="8" height="2" fill="#1c1c1c" /><rect x="31" y="19" width="2" height="8" fill="#1c1c1c" /><circle cx="32" cy="34" r="2.5" fill="#1c1c1c" /><circle cx="32" cy="42" r="1.5" fill="#1c1c1c" /><rect x="28" y="48" width="8" height="2" fill="#1c1c1c" /></svg>);
    case "gc":
      return (<svg viewBox="0 0 64 64" aria-hidden><path d="M32 6 L56 18 L56 44 L32 56 L8 44 L8 18 Z" fill={fill} /><path d="M32 6 L56 18 L32 30 L8 18 Z" fill="#1c1c1c" opacity="0.25" /><path d="M32 30 L32 56 L8 44 L8 18 Z" fill="#1c1c1c" opacity="0.4" /><text x="32" y="40" textAnchor="middle" fill="#1c1c1c" fontSize="14" fontWeight="900" fontFamily="system-ui">G</text></svg>);
    case "n64":
      return (<svg viewBox="0 0 64 64" aria-hidden><path d="M32 8 L48 24 L32 24 Z" fill={fill} /><path d="M32 8 L16 24 L32 24 Z" fill={fill} opacity="0.7" /><path d="M32 56 L48 40 L32 40 Z" fill={fill} opacity="0.5" /><path d="M32 56 L16 40 L32 40 Z" fill={fill} opacity="0.85" /><rect x="14" y="22" width="36" height="20" rx="2" fill="none" stroke={fill} strokeWidth="3" /></svg>);
    case "ps3": case "ps2": case "ps1":
      return (<svg viewBox="0 0 64 64" aria-hidden><text x="32" y="48" textAnchor="middle" fill={fill} fontSize="44" fontWeight="900" fontStyle="italic" fontFamily="Impact, system-ui">PS</text></svg>);
    case "snes":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="22" width="52" height="22" rx="6" fill={fill} /><circle cx="20" cy="33" r="3" fill="#1c1c1c" /><circle cx="44" cy="29" r="2.4" fill="#1c1c1c" /><circle cx="49" cy="33" r="2.4" fill="#1c1c1c" /><circle cx="44" cy="37" r="2.4" fill="#1c1c1c" /><circle cx="39" cy="33" r="2.4" fill="#1c1c1c" /><rect x="14" y="32" width="12" height="2" fill="#1c1c1c" /><rect x="19" y="27" width="2" height="12" fill="#1c1c1c" /><text x="32" y="56" textAnchor="middle" fill={fill} fontSize="9" fontWeight="700" fontFamily="system-ui">SNES</text></svg>);
    case "ps4":
      return (<svg viewBox="0 0 64 64" aria-hidden><text x="20" y="46" textAnchor="middle" fill={fill} fontSize="36" fontWeight="900" fontStyle="italic" fontFamily="Impact, system-ui">PS</text><text x="46" y="46" textAnchor="middle" fill={fill} fontSize="36" fontWeight="900" fontFamily="Impact, system-ui">4</text></svg>);
    case "gba":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="18" width="56" height="28" rx="6" fill={fill} /><rect x="20" y="22" width="24" height="20" rx="2" fill="#1c1c1c" /><circle cx="11" cy="32" r="2.4" fill="#1c1c1c" /><rect x="9" y="30" width="4" height="1.5" fill={fill} /><rect x="10" y="29" width="2" height="6" fill={fill} /><circle cx="50" cy="29" r="2.2" fill="#1c1c1c" /><circle cx="55" cy="34" r="2.2" fill="#1c1c1c" /></svg>);
    case "xbox":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <circle cx="32" cy="32" r="26" fill={fill} />
          <path d="M16 14 Q32 32 48 14" stroke="#1c1c1c" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M16 50 Q32 32 48 50" stroke="#1c1c1c" strokeWidth="5" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "nes":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="36" rx="3" fill={fill} /><rect x="10" y="20" width="44" height="16" fill="#1c1c1c" /><rect x="14" y="40" width="14" height="6" rx="1" fill="#1c1c1c" /><rect x="36" y="40" width="14" height="6" rx="1" fill="#1c1c1c" /><text x="32" y="32" textAnchor="middle" fill={fill} fontSize="9" fontWeight="700" fontFamily="system-ui">NES</text></svg>);
    case "gb":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="14" y="6" width="36" height="52" rx="6" fill={fill} /><rect x="20" y="12" width="24" height="20" rx="2" fill="#1c1c1c" /><circle cx="42" cy="40" r="3" fill="#1c1c1c" /><circle cx="48" cy="44" r="3" fill="#1c1c1c" /><rect x="18" y="42" width="8" height="2" fill="#1c1c1c" /><rect x="21" y="39" width="2" height="8" fill="#1c1c1c" /></svg>);
    case "gbc":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="14" y="6" width="36" height="52" rx="6" fill={fill} /><rect x="20" y="12" width="24" height="20" rx="2" fill="#1c1c1c" /><circle cx="42" cy="40" r="3" fill="#1c1c1c" /><circle cx="48" cy="44" r="3" fill="#1c1c1c" /><rect x="18" y="42" width="8" height="2" fill="#1c1c1c" /><rect x="21" y="39" width="2" height="8" fill="#1c1c1c" /><text x="32" y="56" textAnchor="middle" fill="#1c1c1c" fontSize="6" fontWeight="700" fontFamily="system-ui">COLOR</text></svg>);
    case "md":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="20" width="52" height="24" rx="4" fill={fill} /><rect x="10" y="24" width="44" height="6" fill="#1c1c1c" /><circle cx="14" cy="38" r="2" fill="#1c1c1c" /><circle cx="20" cy="38" r="2" fill="#1c1c1c" /><circle cx="50" cy="38" r="2" fill="#1c1c1c" /><text x="32" y="40" textAnchor="middle" fill="#1c1c1c" fontSize="7" fontWeight="700" fontFamily="system-ui">MD</text></svg>);
    case "retro":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="28" y="10" width="8" height="22" rx="3" fill={fill} /><circle cx="32" cy="12" r="6" fill={fill} /><ellipse cx="32" cy="44" rx="20" ry="14" fill={fill} /><circle cx="22" cy="44" r="3" fill="#1c1c1c" /><circle cx="32" cy="44" r="3" fill="#1c1c1c" /><circle cx="42" cy="44" r="3" fill="#1c1c1c" /></svg>);
    case "dreamcast":
      return (<svg viewBox="0 0 64 64" aria-hidden><circle cx="32" cy="32" r="22" fill="none" stroke={fill} strokeWidth="3" /><path d="M24 22 Q32 14 40 22 Q44 32 38 40 Q30 44 24 38 Q20 30 24 22 Z" fill={fill} /><text x="32" y="56" textAnchor="middle" fill={fill} fontSize="7" fontWeight="800" fontFamily="system-ui">DC</text></svg>);
    case "psp":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="18" width="56" height="28" rx="4" fill={fill} /><rect x="18" y="22" width="28" height="20" rx="1" fill="#1c1c1c" /><circle cx="11" cy="28" r="2" fill="#1c1c1c" /><rect x="9" y="27" width="4" height="2" fill={fill} /><rect x="10" y="26" width="2" height="4" fill={fill} /><circle cx="50" cy="26" r="1.6" fill="#1c1c1c" /><circle cx="54" cy="30" r="1.6" fill="#1c1c1c" /><circle cx="54" cy="38" r="1.6" fill="#1c1c1c" /><circle cx="50" cy="42" r="1.6" fill="#1c1c1c" /><text x="32" y="58" textAnchor="middle" fill={fill} fontSize="7" fontWeight="800" fontFamily="system-ui">PSP</text></svg>);
    case "ds":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="10" y="6" width="44" height="22" rx="3" fill={fill} /><rect x="14" y="10" width="36" height="14" rx="1" fill="#1c1c1c" /><rect x="10" y="32" width="44" height="26" rx="3" fill={fill} /><rect x="14" y="36" width="36" height="16" rx="1" fill="#1c1c1c" /><circle cx="22" cy="44" r="1.5" fill={fill} /><text x="32" y="56" textAnchor="middle" fill={fill} fontSize="6" fontWeight="700" fontFamily="system-ui">DS</text></svg>);
    case "saturn":
      return (<svg viewBox="0 0 64 64" aria-hidden><circle cx="32" cy="32" r="20" fill={fill} /><ellipse cx="32" cy="32" rx="28" ry="6" fill="none" stroke={fill} strokeWidth="2.4" opacity="0.7" /><circle cx="32" cy="32" r="6" fill="#1c1c1c" /></svg>);
    case "sms":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="36" rx="3" fill={fill} /><rect x="10" y="20" width="44" height="14" fill="#1c1c1c" /><circle cx="22" cy="42" r="3" fill="#1c1c1c" /><circle cx="42" cy="42" r="3" fill="#1c1c1c" /><text x="32" y="29" textAnchor="middle" fill={fill} fontSize="6" fontWeight="700" fontFamily="system-ui">MASTER</text></svg>);
    case "gg":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="36" rx="8" fill={fill} /><rect x="22" y="20" width="20" height="14" rx="1" fill="#1c1c1c" /><circle cx="13" cy="32" r="2.5" fill="#1c1c1c" /><rect x="11" y="30" width="5" height="1.6" fill={fill} /><rect x="12" y="29" width="2" height="6" fill={fill} /><circle cx="48" cy="29" r="1.6" fill="#1c1c1c" /><circle cx="54" cy="33" r="1.6" fill="#1c1c1c" /></svg>);
    case "segacd":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="20" width="52" height="24" rx="4" fill={fill} /><circle cx="20" cy="32" r="9" fill="none" stroke="#1c1c1c" strokeWidth="2" /><circle cx="20" cy="32" r="2.5" fill="#1c1c1c" /><text x="42" y="36" textAnchor="middle" fill="#1c1c1c" fontSize="9" fontWeight="800" fontFamily="system-ui">CD</text></svg>);
    case "arcade":
      return (<svg viewBox="0 0 64 64" aria-hidden><path d="M16 6 L48 6 L52 14 L52 50 L46 58 L18 58 L12 50 L12 14 Z" fill={fill} /><rect x="18" y="14" width="28" height="20" rx="1" fill="#1c1c1c" /><circle cx="24" cy="42" r="3" fill="#1c1c1c" /><circle cx="34" cy="42" r="3" fill="#1c1c1c" /><circle cx="40" cy="48" r="2" fill="#1c1c1c" /></svg>);
    case "tg16":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="20" width="52" height="22" rx="3" fill={fill} /><rect x="10" y="24" width="44" height="6" fill="#1c1c1c" /><text x="32" y="40" textAnchor="middle" fill="#1c1c1c" fontSize="8" fontWeight="800" fontFamily="system-ui">PCE</text></svg>);
    case "a2600":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="36" rx="3" fill={fill} /><rect x="10" y="18" width="44" height="12" fill="#1c1c1c" /><text x="32" y="27" textAnchor="middle" fill={fill} fontSize="6" fontWeight="800" fontFamily="system-ui">ATARI</text><rect x="14" y="36" width="36" height="3" fill="#1c1c1c" /><rect x="14" y="42" width="14" height="4" rx="1" fill="#1c1c1c" /><rect x="36" y="42" width="14" height="4" rx="1" fill="#1c1c1c" /></svg>);
    case "lynx":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="20" width="56" height="24" rx="6" fill={fill} /><rect x="20" y="24" width="24" height="16" rx="1" fill="#1c1c1c" /><circle cx="11" cy="32" r="2" fill="#1c1c1c" /><circle cx="52" cy="29" r="1.6" fill="#1c1c1c" /><circle cx="56" cy="33" r="1.6" fill="#1c1c1c" /></svg>);
    case "ws":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="12" y="8" width="40" height="48" rx="6" fill={fill} /><rect x="18" y="14" width="28" height="20" rx="1" fill="#1c1c1c" /><circle cx="22" cy="42" r="2" fill="#1c1c1c" /><circle cx="22" cy="48" r="2" fill="#1c1c1c" /><circle cx="42" cy="44" r="2" fill="#1c1c1c" /><circle cx="42" cy="50" r="2" fill="#1c1c1c" /></svg>);
    case "vb":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="8" y="22" width="48" height="20" rx="6" fill={fill} /><circle cx="22" cy="32" r="6" fill="#1c1c1c" /><circle cx="42" cy="32" r="6" fill="#1c1c1c" /><rect x="28" y="30" width="8" height="4" fill={fill} /></svg>);
    case "ngpc":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="14" y="6" width="36" height="52" rx="6" fill={fill} /><rect x="20" y="12" width="24" height="20" rx="2" fill="#1c1c1c" /><circle cx="24" cy="42" r="2" fill="#1c1c1c" /><rect x="22" y="40" width="4" height="1.6" fill={fill} /><rect x="23" y="39" width="2" height="6" fill={fill} /><circle cx="40" cy="44" r="2.5" fill="#1c1c1c" /></svg>);
    case "msx":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="22" width="52" height="20" rx="2" fill={fill} /><rect x="10" y="26" width="44" height="12" fill="#1c1c1c" /><text x="32" y="36" textAnchor="middle" fill={fill} fontSize="8" fontWeight="800" fontFamily="system-ui">MSX</text></svg>);
    case "c64":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="18" width="52" height="28" rx="3" fill={fill} /><rect x="10" y="22" width="44" height="14" fill="#1c1c1c" /><circle cx="14" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="20" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="26" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="32" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="38" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="44" cy="40" r="1.4" fill="#1c1c1c" /><circle cx="50" cy="40" r="1.4" fill="#1c1c1c" /><text x="32" y="32" textAnchor="middle" fill={fill} fontSize="8" fontWeight="800" fontFamily="system-ui">C64</text></svg>);
    case "zx":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="6" y="14" width="52" height="34" rx="3" fill={fill} /><rect x="10" y="18" width="44" height="20" fill="#1c1c1c" /><rect x="10" y="40" width="6" height="3" fill="#dc2626" /><rect x="18" y="40" width="6" height="3" fill="#f59e0b" /><rect x="26" y="40" width="6" height="3" fill="#fbbf24" /><rect x="34" y="40" width="6" height="3" fill="#22c55e" /><rect x="42" y="40" width="6" height="3" fill="#3b82f6" /><rect x="50" y="40" width="6" height="3" fill="#7c3aed" /></svg>);
    case "amiga":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="22" width="56" height="22" rx="2" fill={fill} /><rect x="8" y="26" width="48" height="14" fill="#1c1c1c" /><text x="32" y="36" textAnchor="middle" fill={fill} fontSize="8" fontWeight="800" fontFamily="system-ui">AMIGA</text></svg>);
    case "threedo":
      return (<svg viewBox="0 0 64 64" aria-hidden><circle cx="32" cy="32" r="22" fill={fill} /><text x="32" y="40" textAnchor="middle" fill="#1c1c1c" fontSize="20" fontWeight="900" fontFamily="system-ui">3DO</text></svg>);
    case "jaguar":
      return (<svg viewBox="0 0 64 64" aria-hidden><polygon points="32 8 56 22 56 42 32 56 8 42 8 22" fill={fill} /><text x="32" y="38" textAnchor="middle" fill="#1c1c1c" fontSize="10" fontWeight="900" fontFamily="system-ui">JAG</text></svg>);
    case "xbox360":
      return (
        <svg viewBox="0 0 64 64" aria-hidden>
          <circle cx="32" cy="32" r="26" fill={fill} />
          <path d="M16 14 Q32 32 48 14" stroke="#1c1c1c" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M16 50 Q32 32 48 50" stroke="#1c1c1c" strokeWidth="5" fill="none" strokeLinecap="round" />
          <text x="32" y="60" textAnchor="middle" fill={fill} fontSize="7" fontWeight="800" fontFamily="system-ui">360</text>
        </svg>
      );
    case "vita":
      return (<svg viewBox="0 0 64 64" aria-hidden><rect x="4" y="16" width="56" height="32" rx="4" fill={fill} /><rect x="16" y="20" width="32" height="24" rx="1" fill="#1c1c1c" /><circle cx="11" cy="26" r="2" fill="#1c1c1c" /><rect x="9" y="25" width="4" height="2" fill={fill} /><rect x="10" y="24" width="2" height="4" fill={fill} /><circle cx="51" cy="24" r="1.4" fill="#1c1c1c" /><circle cx="55" cy="28" r="1.4" fill="#1c1c1c" /><circle cx="55" cy="36" r="1.4" fill="#1c1c1c" /><circle cx="51" cy="40" r="1.4" fill="#1c1c1c" /><text x="32" y="60" textAnchor="middle" fill={fill} fontSize="7" fontWeight="800" fontFamily="system-ui">VITA</text></svg>);
    default: return null;
  }
}
