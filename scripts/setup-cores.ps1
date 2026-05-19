# Setup de cores libretro pro Ludex.
# Baixa Windows (.dll) + Android ARM64 (.so) do buildbot oficial.
# Idempotente — pula cores ja presentes.
#
# Uso:
#   .\scripts\setup-cores.ps1                # baixa tudo que falta
#   .\scripts\setup-cores.ps1 -Force         # re-baixa mesmo se ja existe
#   .\scripts\setup-cores.ps1 -WindowsOnly   # so .dll
#   .\scripts\setup-cores.ps1 -AndroidOnly   # so .so

param(
  [switch]$Force,
  [switch]$WindowsOnly,
  [switch]$AndroidOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$coresDir = Join-Path $root "cores"
$tempDir = Join-Path $env:TEMP "ludex-cores"

New-Item -ItemType Directory -Force -Path $coresDir | Out-Null
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# Lista de cores libretro suportados pelo Ludex.
# Nome = filename sem extensao. Buildbot URL infere disso.
$cores = @(
  "snes9x_libretro",          # SNES
  "mgba_libretro",            # GBA
  "nestopia_libretro",        # NES
  "gambatte_libretro",        # GB/GBC
  "genesis_plus_gx_libretro", # MD/SMS/GG/SegaCD
  "mupen64plus_next_libretro",# N64
  "swanstation_libretro",     # PS1
  "pcsx2_libretro",           # PS2
  "dolphin_libretro",         # Wii/GameCube
  "flycast_libretro",         # Dreamcast
  "ppsspp_libretro",          # PSP
  "citra_libretro",           # 3DS
  "melonds_libretro",         # DS
  "mednafen_saturn_libretro", # Saturn
  "mednafen_pce_libretro",    # TurboGrafx-16
  "mame_libretro",            # Arcade (360 MB!)
  "stella_libretro",          # Atari 2600
  "beetle_lynx_libretro",     # Lynx
  "beetle_ngp_libretro",      # NeoGeo Pocket
  "beetle_vb_libretro",       # Virtual Boy
  "beetle_wswan_libretro",    # WonderSwan
  "bluemsx_libretro",         # MSX
  "vice_x64_libretro",        # C64
  "fuse_libretro",            # ZX Spectrum
  "puae_libretro",            # Amiga
  "opera_libretro",           # 3DO
  "virtualjaguar_libretro"    # Jaguar
)

# Algumas cores tem nome diferente no Android zip
$androidNameOverrides = @{
  "citra_libretro" = "citra_libretro_android"
}

function Download-Core {
  param([string]$Name, [string]$Platform)

  # URL + extensao por plataforma
  if ($Platform -eq "windows") {
    $url = "https://buildbot.libretro.com/nightly/windows/x86_64/latest/$Name.dll.zip"
    $finalExt = "dll"
    $finalName = "$Name.dll"
  } else {
    $androidName = if ($androidNameOverrides.ContainsKey($Name)) { $androidNameOverrides[$Name] } else { $Name }
    $url = "https://buildbot.libretro.com/nightly/android/latest/arm64-v8a/${androidName}.so.zip"
    $finalExt = "so"
    $finalName = "$Name.so"
  }

  $finalPath = Join-Path $coresDir $finalName
  if ((Test-Path $finalPath) -and -not $Force) {
    Write-Host "  [skip] $finalName (ja existe)" -ForegroundColor DarkGray
    return $true
  }

  $zipPath = Join-Path $tempDir "$Name.$Platform.zip"
  $extractDir = Join-Path $tempDir "$Name.$Platform"

  try {
    Write-Host "  [baixar] $finalName ... " -NoNewline
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -ErrorAction Stop
    $size = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "${size}MB" -ForegroundColor Green

    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    # Acha o .dll ou .so dentro do zip
    $extracted = Get-ChildItem $extractDir -Recurse -Filter "*.$finalExt" | Select-Object -First 1
    if (-not $extracted) {
      Write-Host "    [erro] arquivo .$finalExt nao encontrado no zip" -ForegroundColor Red
      return $false
    }

    Copy-Item $extracted.FullName $finalPath -Force
    Remove-Item $zipPath -Force
    Remove-Item $extractDir -Recurse -Force
    return $true
  }
  catch {
    Write-Host ""
    Write-Host "    [erro] $Name $Platform falhou: $_" -ForegroundColor Red
    return $false
  }
}

$ok = 0; $skip = 0; $fail = 0
$total = $cores.Count
$platforms = @()
if (-not $AndroidOnly) { $platforms += "windows" }
if (-not $WindowsOnly) { $platforms += "android" }

Write-Host ""
Write-Host "=== Ludex Setup Cores ===" -ForegroundColor Cyan
Write-Host "Destino: $coresDir"
Write-Host "Plataformas: $($platforms -join ', ')"
Write-Host "Cores: $total"
Write-Host ""

foreach ($platform in $platforms) {
  Write-Host "--- $platform ---" -ForegroundColor Yellow
  $i = 0
  foreach ($name in $cores) {
    $i++
    Write-Host "[$i/$total] " -NoNewline
    $existed = $false
    $finalExt = if ($platform -eq "windows") { "dll" } else { "so" }
    if ((Test-Path (Join-Path $coresDir "$name.$finalExt")) -and -not $Force) { $existed = $true }

    $r = Download-Core -Name $name -Platform $platform
    if ($existed) { $skip++ }
    elseif ($r) { $ok++ }
    else { $fail++ }
  }
}

# Limpa temp se sobrou algo
try { Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}

Write-Host ""
Write-Host "=== Resumo ===" -ForegroundColor Cyan
Write-Host "Baixados: $ok" -ForegroundColor Green
Write-Host "Pulados (ja existiam): $skip" -ForegroundColor DarkGray
if ($fail -gt 0) {
  Write-Host "Falhas: $fail" -ForegroundColor Red
  Write-Host ""
  Write-Host "Cores que falharam podem nao existir no buildbot pra essa plataforma."
  Write-Host "Verifica https://buildbot.libretro.com/nightly/ pra confirmar disponibilidade."
  exit 1
}

Write-Host ""
Write-Host "OK! Cores instalados em $coresDir" -ForegroundColor Green
Write-Host "Roda 'npm run tauri build' pra empacotar no installer."
