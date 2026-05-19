# Ludex

> Sua biblioteca retro em um lugar só. Multi-emulador, fullscreen, com cards bonitos e controle nativo.

Launcher estilo Switch/PS5 que centraliza todos seus emuladores num só lugar:

- Switch (Yuzu), Wii U (Cemu), 3DS (Citra), Wii e GameCube (Dolphin), PS3 (RPCS3), PS2 (PCSX2), PS1 (DuckStation), Xbox (xemu), N64, Genesis, SNES, NES, GBA, GB/GBC e mais
- Capas + screenshots automáticos via IGDB
- Múltiplos perfis com saves isolados (junctions NTFS)
- Tempo jogado, sessões, conquistas locais e integração com **RetroAchievements**
- Música ambiente, Discord Rich Presence, auto-update
- 10 avatares prontos + tour explicativo na primeira execução
- Empty state com botões pra abrir pasta de ROMs / DLCs / Mods + guia de fontes

## 📥 Download

Baixe o instalador da [última release](https://github.com/EllaeMyApp/ludex/releases/latest):

- **Windows 10/11 (x64):** `Ludex_X.Y.Z_x64-setup.exe`

Roda o `.exe` e segue as instruções (vai pedir autorização de administrador pra instalar em `C:\Program Files\Ludex`). Da próxima atualização o Ludex baixa e instala sozinho.

## ⚙️ Pré-requisitos

- **Windows 10 build 1809+** ou **Windows 11**
- **Microsoft Visual C++ Redistributable 2015-2022 (x64)** — baixe em https://aka.ms/vs/17/release/vc_redist.x64.exe
- **WebView2 Runtime** (já vem no Windows 11; no Windows 10 baixe em https://developer.microsoft.com/microsoft-edge/webview2/)
- ~200 MB livres na pasta de instalação + espaço pra suas ROMs/saves
- Opcional: GPU dedicada NVIDIA/AMD pra emuladores pesados (PS3, Switch, Wii U)

## 🎮 Primeira execução

1. Abre o Ludex
2. **Tour explicativo** mostra cada parte da home (topo, plataformas, filtros, biblioteca, ajustes) com banner translúcido animado
3. **Crie seu perfil**: nome + escolha 1 dos 10 avatares prontos OU envie sua própria foto
4. Pronto. A home abre com os emuladores listados

Se você ainda não tem ROMs num emulador específico, o Ludex mostra botões pra:

- 📁 Abrir a pasta certa pra colocar ROMs
- 🎁 Abrir a pasta de DLCs
- 🛠️ Abrir a pasta de Mods/Patches (FPS, resolução, tradução)
- 🌐 Ver guia de onde baixar (categorizado: ROMs, traduções PT-BR, mods, DLCs)
- 🎮 Ver dicas de como configurar controle naquele emulador

## 📂 Onde fica cada coisa

- **App instalado:** `C:\Program Files\Ludex\`
- **Configs e perfis:** `%AppData%\Ludex\` (`config.json`, fotos de perfil)
- **Saves dos emuladores:** dentro de `%AppData%\Ludex\profiles\<id>\saves\<emu>\` (junctions pros paths reais quando isolamento está ativo)
- **ROMs:** detectado automaticamente, ou setado nos Ajustes (padrão: `C:\Ludex-ROMs\`)
- **Logs:** `%LocalAppData%\gg.ludex.app\logs\`

## ⚠️ Importante

- O Ludex **não distribui ROMs**. Use somente jogos que você possui legalmente.
- Mods, patches e DLCs podem corromper saves antigos — faça backup antes de aplicar.
- DLCs precisam ser da mesma região da ROM base (USA / EUR / JPN).
- Os emuladores são programas de terceiros (Yuzu, Dolphin, PCSX2, etc) que você precisa instalar separadamente. O Ludex só lança eles com o jogo certo.
- Cores libretro embutidos rodam *dentro* do Ludex (SNES, NES, GBA, GB, Genesis, N64, PS1).

## 🔧 Atalhos

| Tecla | Ação |
|---|---|
| `←` / `→` | Trocar de plataforma |
| `↑` / `↓` | Navegar nos jogos |
| `Enter` | Abrir jogo |
| `F` | Favoritar / desfavoritar |
| `R` | Sortear jogo aleatório |
| `S` ou `Esc` | Abrir Configurações |
| `P` | Abrir / trocar perfil |
| `/` | Buscar jogo |
| `Select+R1` (controle) | Fechar emulador externo |

## 🛠️ Build (dev)

```bash
git clone https://github.com/EllaeMyApp/ludex.git
cd ludex/app
npm install
# Baixa os 27 cores libretro do buildbot oficial (Windows .dll + Android .so).
# ~1.5 GB total. Idempotente — pula cores ja presentes.
pwsh ./scripts/setup-cores.ps1
npm run tauri:dev    # dev mode com hot reload
npm run tauri:build  # build de produção (NSIS .exe)
```

Os cores ficam em `app/cores/` (gitignored porque `mame_libretro.dll` sozinho tem 360MB, acima do limite GitHub de 100MB).

Stack: Tauri 2 + Rust 1.77+ + React 18 + Vite 5. Veja `app/src-tauri/Cargo.toml`.

## 📜 Licença

Código MIT. Cores libretro mantém suas próprias licenças. Logos/marcas dos consoles são propriedade dos respectivos donos — uso aqui é apenas referencial.
