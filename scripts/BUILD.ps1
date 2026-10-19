$ErrorActionPreference = 'Stop'
$eruRoot = Split-Path $PSScriptRoot -Parent
$eruCache = Join-Path $env:LOCALAPPDATA 'ERU-AI\frontend-alpha-v1'
$eruRuntime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$eruNode = Join-Path $eruRuntime 'node\bin\node.exe'
$eruPnpm = Join-Path $eruRuntime 'bin\fallback\pnpm.cmd'
if (-not (Test-Path -LiteralPath $eruNode)) { $eruNode = (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $eruPnpm)) { $eruPnpm = (Get-Command pnpm -ErrorAction Stop).Source }
New-Item -ItemType Directory -Force -Path $eruCache | Out-Null
Copy-Item (Join-Path $eruRoot 'frontend\src'),(Join-Path $eruRoot 'frontend\public') -Destination $eruCache -Recurse -Force
foreach ($eruFile in @('package.json','index.html','tsconfig.json','vite.config.ts','.npmrc','pnpm-workspace.yaml','pnpm-lock.yaml')) {
    $eruFrom = Join-Path $eruRoot "frontend\$eruFile"
    if (Test-Path -LiteralPath $eruFrom) { Copy-Item -LiteralPath $eruFrom -Destination $eruCache -Force }
}
Push-Location -LiteralPath $eruCache
try {
    $env:CI = 'true'
    & $eruPnpm install --no-frozen-lockfile --config.node-linker=hoisted
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    & $eruNode node_modules/typescript/bin/tsc -b
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed.' }
    & $eruNode node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    & $eruNode node_modules/vitest/vitest.mjs run
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    Copy-Item -LiteralPath (Join-Path $eruCache 'pnpm-lock.yaml') -Destination (Join-Path $eruRoot 'frontend\pnpm-lock.yaml') -Force
    Copy-Item -LiteralPath (Join-Path $eruCache 'dist') -Destination (Join-Path $eruRoot 'frontend') -Recurse -Force
} finally { Pop-Location }
