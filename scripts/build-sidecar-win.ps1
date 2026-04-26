param(
  [string]$TargetTriple = ""
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "scripts/build-sidecar-win.ps1 只能在 Windows 上运行。"
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
    $hostLine = (& rustc -vV | Select-String "^host: " | Select-Object -First 1)
    if ($hostLine) {
      $TargetTriple = $hostLine.ToString().Split(": ")[1].Trim()
    }
    else {
      $TargetTriple = "x86_64-pc-windows-msvc"
    }
  }
}

if (Get-Command py -ErrorAction SilentlyContinue) {
  $script:BasePythonExe = "py"
  $script:BasePythonArgs = @("-3")
}
elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $script:BasePythonExe = "python"
  $script:BasePythonArgs = @()
}
else {
  throw "没有找到 Python。请先安装 Python 3。"
}

function Invoke-BasePython {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & $script:BasePythonExe @script:BasePythonArgs @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Python 命令失败: $script:BasePythonExe $($script:BasePythonArgs + $Args -join ' ')"
  }
}

$venvDir = Join-Path $repoRoot ".cache\sidecar-win-venv"
$pyInstallerRoot = Join-Path $repoRoot ".cache\pyinstaller"
$distDir = Join-Path $pyInstallerRoot "dist"
$workDir = Join-Path $pyInstallerRoot "work"
$specFile = Join-Path $repoRoot "scripts\sidecar.win.spec"
$outputDir = Join-Path $repoRoot "src-tauri\bin"
$outputFile = Join-Path $outputDir "sidecar-$TargetTriple.exe"

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

if (-not (Test-Path (Join-Path $venvDir "Scripts\python.exe"))) {
  Invoke-BasePython -m venv $venvDir
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { throw "升级 pip 失败。" }

& $venvPython -m pip install -r sidecar\requirements.txt -r engine\requirements.txt pyinstaller
if ($LASTEXITCODE -ne 0) { throw "安装 sidecar 打包依赖失败。" }

Remove-Item $distDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue

& $venvPython -m PyInstaller --noconfirm --clean --distpath $distDir --workpath $workDir $specFile
if ($LASTEXITCODE -ne 0) { throw "PyInstaller 打包失败。" }

$builtExe = Join-Path $distDir "sidecar.exe"
if (-not (Test-Path $builtExe)) {
  throw "没有找到打包后的 sidecar.exe。"
}

Copy-Item $builtExe $outputFile -Force
Write-Host "Windows sidecar 已生成: $outputFile"
