param()

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "scripts/package-portable-win.ps1 can only run on Windows."
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
  throw "Release directory was not found. Run tauri build first."
}

$appExe = Join-Path $releaseDir "bitidea-desktop.exe"
$sidecarExe = Join-Path $releaseDir "sidecar.exe"

if (-not (Test-Path $appExe)) {
  throw "Main executable was not found: $appExe"
}

if (-not (Test-Path $sidecarExe)) {
  throw "sidecar.exe was not found: $sidecarExe"
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

1. Double-click Bitidea.exe to launch.
2. Microsoft WebView2 Runtime must already be installed.
3. This portable package does not modify your macOS config directory.
"@ | Set-Content (Join-Path $portableRoot "README.txt") -Encoding UTF8

Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $archivePath -Force

Write-Host "Portable package generated: $archivePath"
