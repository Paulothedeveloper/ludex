# Playbox Launcher

> **Projeto fechado** — distribuição privada via convite. Não republicar binários, ROMs ou cores.

Estúdio de jogos retrô estilo console (Switch/PS5) — todos seus emuladores num único launcher fullscreen com cards, capas IGDB, perfis multi-usuário, conquistas, controle de gamepad nativo, busca, Discord Rich Presence e auto-update.

---

## Requisitos

- **Windows 10 64-bit ou Windows 11** (não testado em macOS/Linux)
- **WebView2** (já vem instalado no Win 11; no Win 10 instala junto com o Edge)
- **GPU dedicada recomendada** — qualquer NVIDIA GTX 1060 / RTX 2060 / RX 580 ou superior pra rodar Switch/PS3/PS4 com upscale
- **8 GB RAM mínimo** (16 GB recomendado pra jogos pesados Switch/PS3)
- **HD/SSD com espaço pra emuladores + ROMs** (~100 GB se você for guardar coleção grande)
- **Controle Xbox/PlayStation/Switch USB ou Bluetooth** (opcional, suporta teclado também)

---

## Instalação

1. Baixe a última release: **`Playbox_X.X.X_x64-setup.exe`** (~33 MB, link direto que o Paulo te passou).
2. Execute o instalador. **Não precisa de admin** — instala em `%LocalAppData%\Programs\Playbox\` (só pro seu usuário).
3. Selecione idioma (PT-BR ou EN) e finalize.
4. Atalho **Playbox** vai aparecer na Área de Trabalho e no menu Iniciar.

> O instalador é "thin": só inclui o launcher + cores libretro internos (SNES/GBA/NES/etc) + músicas ambiente. Os emuladores externos (Citra, Cemu, Dolphin, PCSX2, etc.) você precisa instalar separado — ver seção abaixo.

---

## Estrutura de pastas que o launcher procura

```
D:\Playbox\                        ← raiz recomendada (configurável)
├── emulators\                     ← emuladores externos
│   ├── CITRA\citra-qt.exe         ← 3DS
│   ├── CEMU\Cemu.exe              ← Wii U
│   ├── DOLPHIN\Dolphin.exe        ← Wii / GameCube
│   ├── PCSX2\pcsx2-qt.exe         ← PS2
│   ├── RPCS3\rpcs3.exe            ← PS3
│   ├── DUCKSTATION\duckstation-qt-x64-ReleaseLTCG.exe  ← PS1
│   ├── XBOX\xemu.exe              ← Xbox original
│   │   └── bios\                  ← BIOS Xbox (mcpx, complex, hdd qcow2)
│   ├── shadPS4\shadPS4.exe        ← PS4
│   ├── yuzu\yuzu.exe              ← Switch
│   ├── N64\Project64.exe          ← N64
│   ├── GBA\mGBA.exe               ← GBA standalone
│   └── RETROARCH\retroarch.exe    ← multi-sistema fallback
└── roms\                          ← suas ROMs separadas por sistema
    ├── SWITCH\
    ├── WIIU\
    ├── WII\
    ├── GAMECUBE\
    ├── N64\
    ├── XBOX\
    ├── PS1\, PS2\, PS3\, PS4\
    ├── 3DS\
    ├── GBA\, GB\, GBC\
    ├── NES\, SNES\
    └── SEGA\
```

**Configurando os paths:**
- Por padrão o launcher procura em `D:\Playbox\emulators` e `D:\Playbox\roms`.
- Pra mudar: abrir `%APPDATA%\Playbox\config.json` e editar `emulators_root` e `roms_root`.

---

## Primeiros passos

1. Abre o launcher (atalho Playbox).
2. **Cria perfil** — nome + foto (opcional). Avatares ficam no canto superior esquerdo, dá pra ter vários e trocar a qualquer momento.
3. **Aponta as pastas** — Settings (`S` ou Y do controle) → confere `emulators_root` e `roms_root`.
4. **Adiciona ROMs** na estrutura de pastas acima e o scanner detecta automaticamente.
5. **Capas** — ao detectar ROM novo, o launcher consulta IGDB e baixa capa+screenshots. Se faltar, clique direito no card → "Re-sincronizar capa" ou "Escolher capa do PC".

---

## Atalhos

### Teclado
- `← → ↑ ↓` navegar
- `Enter` lançar jogo
- `D` ver detalhes (overlay full-screen com sumário + screenshots)
- `F` favoritar
- `/` busca
- `S` configurações
- `P` perfil
- `F11` fullscreen toggle
- `F2` overlay diagnóstico de controle
- `Esc` voltar
- `F5/F8` (em jogo libretro embarcado) save state / load state

### Controle (Xbox layout)
- D-Pad / Stick analógico — navegar
- A — lançar
- X — perfil
- Y — configurações
- LB / RB — trocar sistema
- Start — busca
- **Select + Start (durante jogo) — sair pro launcher** (mata o emulador externo automaticamente)

---

## Sistemas suportados

| Sistema | Emulador | Vem com o app? | Onde conseguir |
|---|---|---|---|
| Nintendo Switch | Yuzu | ❌ instalar | (descontinuado oficialmente, você sabe onde achar) |
| Wii U | Cemu | ❌ instalar | https://cemu.info |
| Wii / GameCube | Dolphin | ❌ instalar | https://dolphin-emu.org |
| Nintendo 3DS | Citra | ❌ instalar | (mantido em forks da comunidade) |
| Nintendo 64 | Project64 | ❌ instalar | https://www.pj64-emu.com |
| Xbox | xemu | ❌ instalar + 3 BIOS | https://xemu.app |
| PlayStation 4 | shadPS4 | ❌ instalar | https://shadps4.net |
| PlayStation 3 | RPCS3 | ❌ instalar | https://rpcs3.net |
| PlayStation 2 | PCSX2 | ❌ instalar + BIOS | https://pcsx2.net |
| PlayStation 1 | DuckStation | ❌ instalar + BIOS | https://github.com/stenzek/duckstation |
| Game Boy Advance | mGBA | ❌ standalone (libretro embarcado já vem) | https://mgba.io |
| **SNES, NES, GB, GBC, MD, PS1, GBA** | **libretro embarcado** | ✅ já vem | (não precisa baixar nada) |

---

## Performance — recomendações

### Em laptop com NVIDIA dedicada (Optimus / Hybrid)
**OBRIGATÓRIO** configurar Windows pra usar a dGPU em cada emulador, senão Win 11 default roda na iGPU Intel/AMD e a perf cai pela metade:

1. **Win Settings → Sistema → Tela → Gráficos** → Adicionar → procurar cada `<emulador>.exe` → "Alto desempenho".
2. **NVIDIA Control Panel → Gerenciar Configurações 3D → Programa** → adicionar `<emulador>.exe`:
   - Threaded Optimization → **OFF**
   - Power Management → **Maximum Performance**
   - Vertical Sync → **On**
   - Low Latency Mode → **Ultra**
3. **Hardware-accelerated GPU Scheduling (HAGS)** → Win Settings → Tela → Gráficos → Default → ligado.
4. **Modo Jogo** → Win Settings → Jogos → ligado.
5. Laptop sempre **na tomada** (modo bateria corta clock dGPU).

### Frame pacing / "tá rodando >60 FPS mas engasga"
Especialmente em xemu (Xbox): editar `%APPDATA%\xemu\xemu\xemu.toml`:
```toml
[display]
renderer = 'VULKAN'

[display.window]
fullscreen_exclusive = true
vsync = false
```
NÃO entre em Settings menu do xemu depois — ele apaga keys customizadas.

---

## Troubleshooting comum

### "Emulador não encontrado em ..."
- Confere se `<sistema>\<emulador>.exe` existe no `emulators_root`.
- Confere `%APPDATA%\Playbox\config.json` — `emulators_root` aponta pro lugar certo?

### Capa não baixa pra um jogo
- Clique direito no card → "Re-sincronizar capa".
- Se ainda assim falhar (jogo regional ou nome estranho), clique direito → "Escolher capa do PC" e aponta uma imagem `.jpg` ou `.png`.

### Controle não funciona
- F2 abre overlay de diagnóstico — mostra qual botão tá sendo detectado.
- Se controle Switch Pro / DualSense não tá mapeando: usa via Steam Input ou DS4Windows como bridge XInput.

### "Tela preta" depois de update
- F11 pra alternar fullscreen, às vezes resolve.
- Se persistir: abrir Settings → Diagnóstico → Ver logs do app, ou reinstalar.

### Conquistas / progresso sumiu
- Saves dos jogos ficam em junctions NTFS isoladas por perfil em `%APPDATA%\Playbox\profiles\<id>\`.
- Conquistas e progresso de tempo jogado em `config.json`. Sempre mantenha backup antes de reinstalar.

---

## Privacidade e dados

- **Tudo local.** Não há servidor da Playbox.
- IGDB API é consultada pra capas/sumário (uma vez por jogo, depois fica em cache local).
- Discord Rich Presence (opcional) só envia "Jogando \<nome do jogo\>" pro Discord — desativável em Settings.
- Nenhum log ou telemetria sai do PC.

---

## Suporte

- Repo (privado): https://github.com/EllaeMyApp/playbox-launcher
- Reportar bug ou sugerir feature: contate o Paulo direto (ele tem o canal).

---

## Avisos legais

- ROMs e BIOS não são distribuídas com o app. Use **somente jogos que você possui** legalmente.
- Cores libretro embarcadas (`cores/*.dll`) são GPL e foram baixadas dos canais oficiais Libretro.
- Emuladores externos (xemu, Citra, Cemu, etc.) são software livre — instale sempre da fonte oficial.
- Este projeto é **uso pessoal/educacional**. Não revenda nem republique.

---

**Build atual:** v0.1.0 — 2026-05-07
