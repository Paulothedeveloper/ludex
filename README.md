# Playbox Launcher

Estúdio de jogos retrô estilo console — todos seus emuladores num único launcher fullscreen com cards, capas, perfis, conquistas, gamepad, busca e som.

## Tech
- **Tauri 2** (Rust + WebView2) — bundle nativo Windows ~12MB
- **React 18 + Vite** — UI sem framework UI, CSS puro
- **IGDB API** via Twitch app — capas e screenshots
- **gilrs** — gamepad nativo XInput (atalho Select+Start no jogo)
- **discord-rich-presence** — mostra jogo atual no Discord

## Emuladores suportados
Switch (Yuzu) · Wii U (Cemu) · Wii / GameCube (Dolphin) · N64 (Project64) · GBA (mGBA) · PS1 (DuckStation) · PS2 (PCSX2) · PS3 (RPCS3) · PS4 (shadPS4) · Xbox (xemu) · RetroArch

## Estrutura de pastas (após instalação)
```
%LocalAppData%\Programs\Playbox\          ← app + emuladores bundled
Documents\EMULADORES\ROMS GAMES\<sistema>\ ← ROMs (você popula)
%AppData%\Playbox\config.json              ← perfis, conquistas, configs
```

## Build
```bash
npm install
npm run tauri build
```

Saída: `src-tauri\target\release\bundle\nsis\Playbox_*.exe` (instalador NSIS ~487 MB com todos os emuladores).

## Atalhos teclado
- `← → ↑ ↓` navegar · `Enter` lançar · `D` ver detalhes
- `F` favorito · `/` busca · `S` config · `P` perfil · `F11` fullscreen
- `Esc` voltar · `Select+Start` (controle, no jogo) sair pro launcher
