param()

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "scripts/package-portable-win.ps1 只能在 Windows 上运行。"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$packageJson = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$targetTriple = if ($env:BITIDEA_WINDOWS_TARGET_TRIPLE) {
  $env:BITIDEA_WINDOWS_TARGET_TRIPLE
}
elseif ($env:CARGO_BUILD_TARGET) {
  $env:CARGO_BUILD_TARGET
}
elseif ($env:TAURI_TARGET) {
  $env:TAURI_TARGET
}
else {
  ""
}

$releaseCandidates = @()
if ($targetTriple) {
  $releaseCandidates += Join-Path $repoRoot "src-tauri\target\$targetTriple\release"
}
$releaseCandidates += Join-Path $repoRoot "src-tauri\target\release"
$releaseDir = $releaseCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $releaseDir) {
  throw "没有找到 release 目录，请先运行 tauri build。"
}

$appExe = Join-Path $releaseDir "bitidea-desktop.exe"
$sidecarExe = Join-Path $releaseDir "sidecar.exe"

if (-not (Test-Path $appExe)) {
  throw "没有找到主程序: $appExe"
}

if (-not (Test-Path $sidecarExe)) {
  throw "没有找到 sidecar: $sidecarExe"
}

$distRoot = Join-Path $repoRoot "dist\windows"
$portableRoot = Join-Path $distRoot "portable\Bitidea"
$archivePath = Join-Path $distRoot "Bitidea-$version-windows-portable.zip"

Remove-Item $portableRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null

Copy-Item $appExe (Join-Path $portableRoot "Bitidea.exe") -Force
Copy-Item $sidecarExe (Join-Path $portableRoot "sidecar.exe") -Force

@"
Bitidea Windows Portable
========================

1. 双击 Bitidea.exe 启动。
2. 首次运行需要系统已安装 Microsoft WebView2 Runtime。
3. 这个便携包不会改动你当前的 macOS 配置目录。
"@ | Set-Content (Join-Path $portableRoot "README.txt") -Encoding UTF8

Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $archivePath -Force

Write-Host "便携包已生成: $archivePath"
