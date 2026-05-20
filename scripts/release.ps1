# Script de release do Ludex
# Uso: .\scripts\release.ps1 -Version "0.6.5" -Notes "Descricao"
# Por padrao: builda EXE (Windows) + APK (Android universal release).
# Flags:
#   -SkipAndroid : pula build do APK (release so com EXE - users mobile NAO terao auto-update)
#   -SkipWindows : pula build do EXE
#   -DryRun      : nao cria release no GitHub, so builda

param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$Notes,
  [switch]$SkipAndroid,
  [switch]$SkipWindows,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Write-Host "=== Ludex Release v$Version ===" -ForegroundColor Cyan

# 1. Atualiza version em 3 arquivos (regex no-reformat, sem BOM)
Write-Host "[1/5] Atualizando version em package.json, Cargo.toml e tauri.conf.json"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Set-FileUtf8NoBom([string]$path, [string]$content) {
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

# package.json - troca soh a primeira ocorrencia de "version"
$pkgPath = "$root\package.json"
$pkgRaw = [System.IO.File]::ReadAllText($pkgPath)
$pkgNew = [regex]::Replace($pkgRaw, '"version"\s*:\s*"[^"]+"', "`"version`": `"$Version`"", 1)
Set-FileUtf8NoBom $pkgPath $pkgNew

# tauri.conf.json - mesma logica
$tauriPath = "$root\src-tauri\tauri.conf.json"
$tauriRaw = [System.IO.File]::ReadAllText($tauriPath)
$tauriNew = [regex]::Replace($tauriRaw, '"version"\s*:\s*"[^"]+"', "`"version`": `"$Version`"", 1)
Set-FileUtf8NoBom $tauriPath $tauriNew

# Cargo.toml - primeira linha 'version = "..."' (so a do [package], nao das deps)
$cargoPath = "$root\src-tauri\Cargo.toml"
$cargoRaw = [System.IO.File]::ReadAllText($cargoPath)
$cargoNew = [regex]::Replace($cargoRaw, '(?m)^version = "[^"]+"', "version = `"$Version`"", 1)
Set-FileUtf8NoBom $cargoPath $cargoNew

# 2. Build Windows (assinado) + Android (APK universal-release)
$nsisExe = "$root\src-tauri\target\release\bundle\nsis\Ludex_${Version}_x64-setup.exe"
$nsisSig = "$nsisExe.sig"
$apkSrc  = "$root\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk"
$apkUnsigned = "$root\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
$apkRenamed = "$root\src-tauri\gen\android\app\build\outputs\apk\universal\release\Ludex_${Version}.apk"

if (-not $SkipWindows) {
  Write-Host "[2a] Build Windows assinado (pode demorar 5-10min)"
  $env:TAURI_SIGNING_PRIVATE_KEY = "$root\src-tauri\playbox-update.key"
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
  Push-Location $root
  try {
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "Build Windows falhou" }
  } finally { Pop-Location }
  if (-not (Test-Path $nsisExe)) { throw "Instalador nao encontrado: $nsisExe" }
  if (-not (Test-Path $nsisSig)) { throw "Assinatura nao encontrada: $nsisSig" }
}

if (-not $SkipAndroid) {
  Write-Host "[2b] Build Android APK (universal-release, pode demorar 8-15min)"
  Push-Location $root
  try {
    npm run tauri android build -- --apk
    if ($LASTEXITCODE -ne 0) { throw "Build Android falhou. Confirme ANDROID_HOME e NDK_HOME setados." }
  } finally { Pop-Location }
  # Tauri pode gerar app-universal-release-unsigned.apk ou app-universal-release.apk
  $apkBuilt = $null
  if (Test-Path $apkSrc) { $apkBuilt = $apkSrc }
  elseif (Test-Path $apkUnsigned) { $apkBuilt = $apkUnsigned }
  else { throw "APK nao encontrado em $apkSrc nem $apkUnsigned" }
  Copy-Item $apkBuilt $apkRenamed -Force
  Write-Host "  APK pronto: $apkRenamed ($([math]::Round((Get-Item $apkRenamed).Length/1MB,1))MB)"
}

# 3. Gera latest.json
$signature = if (-not $SkipWindows) { (Get-Content $nsisSig -Raw).Trim() } else { "" }
$pubDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

Write-Host "[3] Gerando latest.json"
$platforms = @{}
if (-not $SkipWindows) {
  $platforms["windows-x86_64"] = @{
    signature = $signature
    url       = "https://github.com/EllaeMyApp/ludex/releases/download/v$Version/Ludex_${Version}_x64-setup.exe"
  }
}
$latest = @{
  version  = $Version
  notes    = $Notes
  pub_date = $pubDate
  platforms = $platforms
}
$latestPath = "$root\src-tauri\target\release\bundle\nsis\latest.json"
$null = New-Item -ItemType Directory -Path (Split-Path $latestPath -Parent) -Force
# v0.9.2: ESCREVE SEM BOM. Set-Content -Encoding utf8 (PS 5.1) adiciona BOM,
# e o parser JSON do updater do Tauri quebra com BOM no inicio -> erro
# "missing field platforms" / "expected value". Era por isso que o auto-update
# do PC nao funcionava. WriteAllText com UTF8Encoding($false) = sem BOM.
$latestJson = $latest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($latestPath, $latestJson, (New-Object System.Text.UTF8Encoding($false)))

if ($DryRun) {
  Write-Host "`n=== DryRun - artefatos gerados, release NAO criada ===" -ForegroundColor Yellow
  if (-not $SkipWindows) { Write-Host "  EXE: $nsisExe" }
  if (-not $SkipAndroid) { Write-Host "  APK: $apkRenamed" }
  Write-Host "  latest.json: $latestPath"
  return
}

# 4. Commit + tag + release no GitHub
Write-Host "[4] Commit + tag v$Version"
Push-Location $root
try {
  git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
  git diff --staged --quiet
  if ($LASTEXITCODE -ne 0) {
    git commit -m "chore: bump v$Version"
  } else {
    Write-Host "  (sem mudancas de versao pra commitar - bump ja feito)"
  }
  # Cria tag soh se nao existir
  $tagExists = git tag --list "v$Version"
  if (-not $tagExists) { git tag "v$Version" }
  git push origin master --tags

  Write-Host "[5] Criando release no GitHub"
  $assets = @($latestPath)
  if (-not $SkipWindows) { $assets += $nsisExe }
  if (-not $SkipAndroid) { $assets += $apkRenamed }
  gh release create "v$Version" $assets `
    --title "v$Version" `
    --notes "$Notes"
} finally { Pop-Location }

Write-Host "`n=== OK! Release v$Version publicada ===" -ForegroundColor Green
Write-Host "URL: https://github.com/EllaeMyApp/ludex/releases/tag/v$Version"
Write-Host "Windows: auto-update na proxima abertura."
if (-not $SkipAndroid) {
  Write-Host "Android: APK disponivel em Ludex_${Version}.apk (auto-update Mobile pega via check_update_info)."
}
