# Builds a clean FreeClaude release (no personal keys / auth dumps).
$ErrorActionPreference = "Stop"
$node = "C:\Program Files\nodejs\node.exe"
$npmCli = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $root "_release_stage"
$out = Join-Path (Split-Path $root -Parent) "dist\FreeClaude"

Write-Host "== FreeClaude release build ==" -ForegroundColor Cyan
Write-Host "stage: $stage"
Write-Host "out:   $out"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $out -Force | Out-Null

# Clean sources only (no config keys, no _auth/_poll dumps)
Copy-Item (Join-Path $root "server.js") $stage
Copy-Item (Join-Path $root "omni-keys.js") $stage
Copy-Item (Join-Path $root "omni-keys-proxy.js") $stage
Copy-Item (Join-Path $root "sqlite-bridge.js") $stage
Copy-Item (Join-Path $root "package.json") $stage
Copy-Item (Join-Path $root "public") (Join-Path $stage "public") -Recurse

Set-Location $stage
Write-Host "`n[1/4] npm install..." -ForegroundColor Yellow
& $node $npmCli install --omit=dev --no-fund --no-audit
& $node $npmCli install --no-save --no-fund --no-audit javascript-obfuscator@4.1.1 @yao-pkg/pkg@6.3.2

Write-Host "`n[2/4] obfuscate... SKIPPED (breaks pkg runtime)" -ForegroundColor Yellow
# Identifier obfuscation caused ACCESS_VIOLATION in pkg builds.
# Protection = packaged binary + no shipped secrets. Optional VMProtect later.


Write-Host "`n[3/4] package exe..." -ForegroundColor Yellow
$pkgBin = Join-Path $stage "node_modules\@yao-pkg\pkg\lib-es5\bin.js"
& $node $pkgBin . --targets node22-win-x64 --output (Join-Path $out "FreeClaude.exe") --compress GZip

Write-Host "`n[4/4] copy runtime files..." -ForegroundColor Yellow
Copy-Item (Join-Path $stage "public") (Join-Path $out "public") -Recurse -Force
Copy-Item (Join-Path $root "omni-keys.js") (Join-Path $out "omni-keys.js") -Force
Copy-Item (Join-Path $root "sqlite-bridge.js") (Join-Path $out "sqlite-bridge.js") -Force

# Native module beside exe (loaded via system Node bridge — pkg cannot load .node safely)
$runtimePkg = @{
  name = "freeclaude-runtime"
  private = $true
  dependencies = @{ "better-sqlite3" = "^13.0.3" }
} | ConvertTo-Json -Compress
Set-Content -Path (Join-Path $out "package.json") -Value $runtimePkg -Encoding UTF8
Push-Location $out
& $node $npmCli install --omit=dev --no-fund --no-audit
Pop-Location

@'
@echo off
setlocal EnableExtensions
cd /d "%~dp0"
REM Optional helper. Prefer double-click FreeClaude.exe (one process, one window).
start "" "%~dp0FreeClaude.exe"
exit /b 0
'@ | Set-Content -Encoding ASCII (Join-Path $out "FreeClaude.cmd")

@'
FreeClaude
==========

Запуск: двойной клик по FreeClaude.exe
(одна программа — сайт + OmniRoute в фоне + браузер)

Адрес: http://127.0.0.1:3847

На чистой Windows: Настройки → «Установить недостающее»
(Node.js, OmniRoute, Claude Code).

Данные: %APPDATA%\FreeClaude
'@ | Set-Content -Encoding UTF8 (Join-Path $out "README.txt")

Remove-Item (Join-Path $out "package.json") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $out "package-lock.json") -Force -ErrorAction SilentlyContinue

Write-Host "`nDONE: $out" -ForegroundColor Green
Get-ChildItem $out | Format-Table Name, Length -AutoSize
Write-Host ("Size MB: {0:N1}" -f ((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
