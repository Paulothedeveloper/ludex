# Script de release do Playbox Launcher
# Uso: .\scripts\release.ps1 -Version "0.1.1" -Notes "Descricao da release"

param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$Notes
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Write-Host "=== Playbox Release v$Version ===" -ForegroundColor Cyan

# 1. Atualiza version em 3 arquivos
Write-Host "[1/5] Atualizando version em package.json, Cargo.toml e tauri.conf.json"
$pkg = Get-Content "$root\package.json" -Raw | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 32 | Set-Content "$root\package.json" -Encoding utf8

$tauri = Get-Content "$root\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$tauri.version = $Version
$tauri | ConvertTo-Json -Depth 32 | Set-Content "$root\src-tauri\tauri.conf.json" -Encoding utf8

(Get-Content "$root\src-tauri\Cargo.toml") `
  -replace '^version = "[^"]+"', "version = `"$Version`"" |
  Set-Content "$root\src-tauri\Cargo.toml" -Encoding utf8

# 2. Build com signing
Write-Host "[2/5] Build assinado (pode demorar 5-10min)"
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$root\src-tauri\playbox-update.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
Push-Location $root
try {
  npm run tauri build
  if ($LASTEXITCODE -ne 0) { throw "Build falhou" }
} finally {
  Pop-Location
}

# 3. Localiza artefatos
$nsisExe = "$root\src-tauri\target\release\bundle\nsis\Playbox_${Version}_x64-setup.exe"
$nsisSig = "$nsisExe.sig"
if (-not (Test-Path $nsisExe)) { throw "Instalador nao encontrado: $nsisExe" }
if (-not (Test-Path $nsisSig)) { throw "Assinatura nao encontrada: $nsisSig" }

$signature = (Get-Content $nsisSig -Raw).Trim()
$pubDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

# 4. Gera latest.json
Write-Host "[3/5] Gerando latest.json"
$latest = @{
  version  = $Version
  notes    = $Notes
  pub_date = $pubDate
  platforms = @{
    "windows-x86_64" = @{
      signature = $signature
      url       = "https://github.com/EllaeMyApp/playbox-launcher/releases/download/v$Version/Playbox_${Version}_x64-setup.exe"
    }
  }
}
$latestPath = "$root\src-tauri\target\release\bundle\nsis\latest.json"
$latest | ConvertTo-Json -Depth 8 | Set-Content $latestPath -Encoding utf8

# 5. Commita versao + cria release
Write-Host "[4/5] Commit + tag v$Version"
Push-Location $root
try {
  git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
  git commit -m "chore: bump v$Version"
  git tag "v$Version"
  git push origin master --tags

  Write-Host "[5/5] Criando release no GitHub"
  gh release create "v$Version" `
    "$nsisExe" `
    "$latestPath" `
    --title "v$Version" `
    --notes "$Notes"
} finally {
  Pop-Location
}

Write-Host "`n=== OK! Release v$Version publicada ===" -ForegroundColor Green
Write-Host "URL: https://github.com/EllaeMyApp/playbox-launcher/releases/tag/v$Version"
Write-Host "Usuarios com a versao antiga vao receber a atualizacao na proxima vez que abrirem (ou clicarem em 'Verificar atualizacao')."
