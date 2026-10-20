$ErrorActionPreference = 'Stop'
$eruRoot = Split-Path $PSScriptRoot -Parent
$eruPython = Join-Path $env:LOCALAPPDATA 'ERU-AI\alpha-v1-venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $eruPython) -or -not (Test-Path -LiteralPath (Join-Path $eruRoot 'frontend\dist\index.html'))) {
    & (Join-Path $PSScriptRoot 'SETUP.ps1')
}
Set-Location -LiteralPath $eruRoot
$eruHealth = $null
try {
    $eruHealth = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2
} catch { }
if ($eruHealth) {
    if ($eruHealth.version -in @('Alpha V1','모의투자 V2','AI 동행 투자 V3')) { Start-Process 'http://127.0.0.1:8000'; exit 0 }
    throw 'Port 8000 is occupied by another application.'
}
$eruState = Join-Path $env:LOCALAPPDATA 'ERU-AI'
New-Item -ItemType Directory -Force -Path $eruState | Out-Null
$eruProcess = Start-Process -FilePath $eruPython -ArgumentList @('-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $eruRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $eruState 'server-out.log') -RedirectStandardError (Join-Path $eruState 'server-error.log')
$eruProcess.Id | Out-File -LiteralPath (Join-Path $eruState 'server.pid') -Encoding ascii
for ($eruAttempt=0; $eruAttempt -lt 60; $eruAttempt++) {
    Start-Sleep -Milliseconds 250
    try {
        $eruHealth = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2
        if ($eruHealth.version -in @('Alpha V1','모의투자 V2','AI 동행 투자 V3')) {
            $eruListener = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($eruListener) { $eruListener.OwningProcess | Out-File -LiteralPath (Join-Path $eruState 'server.pid') -Encoding ascii }
            Start-Process 'http://127.0.0.1:8000'
            Write-Host 'ERU AI started. Use STOP_ERU_AI.cmd to stop the server.'
            exit 0
        }
    } catch { }
    if ($eruProcess.HasExited) { throw "Server failed. See $eruState\server-error.log" }
}
throw "Server startup timeout. See $eruState\server-error.log"
