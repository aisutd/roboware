# Starts the RoboWare backend (port 8080) and frontend (port 5173) in two new PowerShell windows,
# installing dependencies on the first run, then opens the app in the browser.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$python = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
    python -m venv (Join-Path $backend '.venv')
    & $python -m pip install -r (Join-Path $backend 'requirements.txt')
}
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Push-Location $frontend
    npm install
    Pop-Location
}

Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$backend'; & '$python' -m uvicorn app.main:app --reload --port 8080"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$frontend'; npm run dev"
Start-Sleep -Seconds 4
Start-Process 'http://localhost:5173'
