# Builds a clean FreeClaude release (no personal keys / auth dumps).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $root "_release_stage"
$out = Join-Path (Split-Path $root -Parent) "dist\FreeClaude"

# $ErrorActionPreference does not react to non-zero exit codes from native programs,
# so a failed npm/pkg run would otherwise sail through and ship a broken build.
function Invoke-Checked {
  param([string]$What, [scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

function Resolve-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in @(
      "C:\Program Files\nodejs\node.exe",
      "C:\Program Files (x86)\nodejs\node.exe",
      (Join-Path $env:LOCALAPPDATA "Programs\node\node.exe")
    )) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw "Node.js не найден. Установи Node.js 22+ или добавь node.exe в PATH."
}

$node = Resolve-NodeExe
$nodeHome = Split-Path $node -Parent
$npmCli = Join-Path $nodeHome "node_modules\npm\bin\npm-cli.js"
if (-not (Test-Path $npmCli)) { throw "npm-cli.js не найден рядом с $node" }

$nodeMajor = [int]((& $node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 22) { throw "Нужен Node.js 22+, а найден $nodeMajor ($node)" }

$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version

Write-Host "== FreeClaude release build ==" -ForegroundColor Cyan
Write-Host "version: $version"
Write-Host "node:    $node (v$nodeMajor)"
Write-Host "stage:   $stage"
Write-Host "out:     $out"

# A running exe keeps its file locked and would make Remove-Item fail with a raw error.
$running = Get-Process -Name FreeClaude -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "`nFreeClaude.exe запущен — закрываю перед сборкой..." -ForegroundColor Yellow
  $running | Stop-Process -Force
  Start-Sleep -Seconds 2
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $out) {
  try {
    Remove-Item $out -Recurse -Force
  } catch {
    throw "Не удалось очистить $out (файл занят?). Закрой FreeClaude и проводник в этой папке. $_"
  }
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $out -Force | Out-Null

# Clean sources only (no config keys, no scratch dumps)
$sources = @(
  "server.js",
  "omni-keys.js",
  "omni-keys-proxy.js",
  "node-resolve.js",
  "format-duration.js",
  "sqlite-bridge.js",
  "package.json",
  "package-lock.json"
)
foreach ($f in $sources) { Copy-Item (Join-Path $root $f) $stage }
Copy-Item (Join-Path $root "public") (Join-Path $stage "public") -Recurse

Set-Location $stage
Write-Host "`n[1/4] npm install..." -ForegroundColor Yellow
Invoke-Checked "npm ci" { & $node $npmCli ci --omit=dev --no-fund --no-audit }
Invoke-Checked "npm install pkg" { & $node $npmCli install --no-save --no-fund --no-audit "@yao-pkg/pkg@6.3.2" }

Write-Host "`n[2/4] obfuscate... SKIPPED (breaks pkg runtime)" -ForegroundColor Yellow
# Identifier obfuscation caused ACCESS_VIOLATION in pkg builds.
# Protection = packaged binary + no shipped secrets. Optional VMProtect later.

Write-Host "`n[3/4] package exe..." -ForegroundColor Yellow
$pkgBin = Join-Path $stage "node_modules\@yao-pkg\pkg\lib-es5\bin.js"
Invoke-Checked "pkg" { & $node $pkgBin . --targets node22-win-x64 --output (Join-Path $out "FreeClaude.exe") --compress GZip }

Write-Host "`n[4/4] copy runtime files..." -ForegroundColor Yellow
Copy-Item (Join-Path $stage "public") (Join-Path $out "public") -Recurse -Force
foreach ($f in @("omni-keys.js", "node-resolve.js", "format-duration.js", "sqlite-bridge.js")) {
  Copy-Item (Join-Path $root $f) (Join-Path $out $f) -Force
}

# Native module beside exe (loaded via system Node bridge — pkg cannot load .node safely).
# Pinned exactly so a rebuild cannot silently pick up a different ABI.
$runtimePkg = @{
  name = "freeclaude-runtime"
  private = $true
  dependencies = @{ "better-sqlite3" = "13.0.3" }
} | ConvertTo-Json -Compress
Set-Content -Path (Join-Path $out "package.json") -Value $runtimePkg -Encoding UTF8
Push-Location $out
try {
  Invoke-Checked "runtime npm install" { & $node $npmCli install --omit=dev --no-fund --no-audit }
} finally {
  Pop-Location
}

@'
@echo off
setlocal EnableExtensions
cd /d "%~dp0"
REM Optional helper. Prefer double-click FreeClaude.exe (one process, one window).
start "" "%~dp0FreeClaude.exe"
exit /b 0
'@ | Set-Content -Encoding ASCII (Join-Path $out "FreeClaude.cmd")

@"
FreeClaude $version
==========

Запуск: двойной клик по FreeClaude.exe
(одна программа — сайт + OmniRoute в фоне + браузер)

Адрес: http://127.0.0.1:3847

На чистой Windows: Настройки → «Установить недостающее»
(Node.js, OmniRoute, Claude Code).

Требуется Node.js 22+ (для работы с ключами OmniRoute).

Данные: %APPDATA%\FreeClaude
"@ | Set-Content -Encoding UTF8 (Join-Path $out "README.txt")

Remove-Item (Join-Path $out "package.json") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $out "package-lock.json") -Force -ErrorAction SilentlyContinue

Write-Host "`nverifying output..." -ForegroundColor Yellow
$required = @(
  "FreeClaude.exe",
  "sqlite-bridge.js",
  "omni-keys.js",
  "node-resolve.js",
  "format-duration.js",
  "public\index.html",
  "node_modules\better-sqlite3\package.json"
)
foreach ($rel in $required) {
  $p = Join-Path $out $rel
  if (-not (Test-Path $p)) { throw "Сборка неполная: не хватает $rel" }
}
$exe = Get-Item (Join-Path $out "FreeClaude.exe")
if ($exe.Length -lt 10MB) { throw "FreeClaude.exe подозрительно мал ($($exe.Length) байт)" }

Write-Host "`nDONE: $out" -ForegroundColor Green
Get-ChildItem $out | Format-Table Name, Length -AutoSize
Write-Host ("Size MB: {0:N1}" -f ((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
