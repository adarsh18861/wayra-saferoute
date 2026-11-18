# One-time setup for Windows (PowerShell).
# Creates backend/.venv with Python 3.11, installs Python deps, and installs npm deps.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$venvPython = Join-Path $backend ".venv\Scripts\python.exe"

# Find an official CPython 3.11 (MSYS2/MinGW Python can't install pandas/pyarrow/lightgbm wheels).
$python = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    try { & py -3.11 --version *> $null; if ($LASTEXITCODE -eq 0) { $python = @("py", "-3.11") } } catch {}
}
if (-not $python) {
    $candidate = Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"
    if (Test-Path $candidate) { $python = @($candidate) }
}
if (-not $python) {
    Write-Error "Python 3.11 not found. Install it with: winget install -e --id Python.Python.3.11 --scope user"
}

if (-not (Test-Path $venvPython)) {
    Write-Host "Creating backend/.venv ..."
    $exe = $python[0]; $pyArgs = @($python | Select-Object -Skip 1)
    & $exe @pyArgs -m venv (Join-Path $backend ".venv")
}

Write-Host "Installing Python dependencies ..."
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $backend "requirements.txt")

Write-Host "Installing npm dependencies ..."
Push-Location $root; npm install; Pop-Location
Push-Location (Join-Path $root "frontend"); npm install; Pop-Location

if (-not (Test-Path (Join-Path $root ".env"))) {
    Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
    Write-Host "Created .env from .env.example"
}
Write-Host "Setup complete. Run: npm run dev"
