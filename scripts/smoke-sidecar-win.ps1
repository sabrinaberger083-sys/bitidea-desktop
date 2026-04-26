param(
  [string]$TargetTriple = ""
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "scripts/smoke-sidecar-win.ps1 只能在 Windows 上运行。"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

if (-not $TargetTriple) {
  if ($env:BITIDEA_WINDOWS_TARGET_TRIPLE) {
    $TargetTriple = $env:BITIDEA_WINDOWS_TARGET_TRIPLE
  }
  elseif ($env:CARGO_BUILD_TARGET) {
    $TargetTriple = $env:CARGO_BUILD_TARGET
  }
  elseif ($env:TAURI_TARGET) {
    $TargetTriple = $env:TAURI_TARGET
  }
  else {
    $TargetTriple = "x86_64-pc-windows-msvc"
  }
}

$exePath = Join-Path $repoRoot "src-tauri\bin\sidecar-$TargetTriple.exe"
if (-not (Test-Path $exePath)) {
  throw "没有找到 sidecar 可执行文件: $exePath"
}

$tmpDir = Join-Path $repoRoot ".cache\sidecar-smoke"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$stdoutPath = Join-Path $tmpDir "stdout.log"
$stderrPath = Join-Path $tmpDir "stderr.log"
Remove-Item $stdoutPath -Force -ErrorAction SilentlyContinue
Remove-Item $stderrPath -Force -ErrorAction SilentlyContinue

$process = Start-Process `
  -FilePath $exePath `
  -WorkingDirectory (Split-Path $exePath) `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -WindowStyle Hidden `
  -PassThru

$deadline = (Get-Date).AddSeconds(20)
$portSeen = $false
$tokenSeen = $false
$readySeen = $false

try {
  while ((Get-Date) -lt $deadline -and -not $readySeen) {
    if ($process.HasExited) {
      $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { "" }
      throw "sidecar 提前退出，退出码 $($process.ExitCode)。stderr: $stderr"
    }

    if (Test-Path $stdoutPath) {
      $stdout = Get-Content $stdoutPath -Raw
      if ($stdout -match "SIDECAR_PORT=") { $portSeen = $true }
      if ($stdout -match "SIDECAR_TOKEN=") { $tokenSeen = $true }
      if ($stdout -match "SIDECAR_READY") { $readySeen = $true }
    }

    Start-Sleep -Milliseconds 200
  }

  if (-not ($portSeen -and $tokenSeen -and $readySeen)) {
    $stdout = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw } else { "" }
    $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { "" }
    throw "sidecar smoke test 未通过。stdout: $stdout stderr: $stderr"
  }

  Write-Host "sidecar smoke test passed: $exePath"
}
finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}
