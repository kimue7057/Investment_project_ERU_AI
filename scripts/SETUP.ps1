$ErrorActionPreference = 'Stop'
$eruRoot = Split-Path $PSScriptRoot -Parent
$eruRuntime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$eruPython = Join-Path $eruRuntime 'python\python.exe'
if (-not (Test-Path -LiteralPath $eruPython)) {
    $eruPython = (Get-Command python -ErrorAction Stop).Source
}
$eruVenv = Join-Path $env:LOCALAPPDATA 'ERU-AI\alpha-v1-venv'
if (-not (Test-Path -LiteralPath (Join-Path $eruVenv 'Scripts\python.exe'))) {
    & $eruPython -m venv $eruVenv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
$eruPython = Join-Path $eruVenv 'Scripts\python.exe'
Set-Location -LiteralPath $eruRoot
& $eruPython -m pip install -r backend/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
if (-not (Test-Path -LiteralPath 'data\normalized\D_upbit_ohlcv_daily.csv')) {
    & $eruPython scripts/collect_upbit.py
    if ($LASTEXITCODE -ne 0) { throw 'Real market data collection failed. See reports.' }
}
& $eruPython scripts/validate_data.py
if ($LASTEXITCODE -ne 0) { throw 'Market data validation failed. App was not started.' }
& (Join-Path $PSScriptRoot 'BUILD.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
Write-Host 'Setup complete. Run RUN_ERU_AI.cmd.'
