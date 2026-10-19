$ErrorActionPreference = 'Stop'
$eruPidFile = Join-Path $env:LOCALAPPDATA 'ERU-AI\server.pid'
if (-not (Test-Path -LiteralPath $eruPidFile)) { Write-Host 'No managed ERU AI server is running.'; exit 0 }
$eruServerId = [int](Get-Content -LiteralPath $eruPidFile -Raw).Trim()
$eruServer = Get-CimInstance Win32_Process -Filter "ProcessId=$eruServerId" -ErrorAction SilentlyContinue
if ($eruServer -and $eruServer.CommandLine -like '*uvicorn backend.app.main:app*' -and $eruServer.CommandLine -like '*--port 8000*') {
    Stop-Process -Id $eruServerId
    Write-Host 'ERU AI server stopped. Saved games are retained.'
} elseif ($eruServer) { throw 'The stored PID belongs to another process; it was not stopped.' }
