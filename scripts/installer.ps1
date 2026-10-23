# Type-checks, tests and builds the Windows installer and the portable zip into release\
$ErrorActionPreference = "Stop"
Set-Location -Path (Join-Path $PSScriptRoot "..")

function Step($label, [scriptblock]$cmd) {
    Write-Host "-> $label"
    & $cmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "BUILD STOPPED: $label failed (exit code $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path "node_modules")) { Step "Install dependencies (first run only)" { npm install } }
if (-not (Test-Path "build\icon.ico")) { Step "Generate icons" { npm run icon } }
Step "Run tests" { npm test }
# dist also runs the type-check first.
Step "Build installer and portable zip" { npm run dist }

$version = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
Write-Host ""
Write-Host "Done. The installer is 'release\ExplainerStudio-Setup-$version.exe'." -ForegroundColor Green
Write-Host "The portable zip is 'release\ExplainerStudio-$version-portable.zip'." -ForegroundColor Green
