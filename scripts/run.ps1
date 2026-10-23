# Starts Explainer Studio in development mode with hot reload.
$ErrorActionPreference = "Stop"
Set-Location -Path (Join-Path $PSScriptRoot "..")

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies (first run only)..."
    npm install
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

if (-not (Test-Path "build\icon.ico") -or -not (Test-Path "resources\icon.png")) {
    Write-Host "Generating icons (first run only)..."
    npm run icon
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

npm run dev
