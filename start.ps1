# Gift City AIF Forward Tester - Windows local launcher (API + UI)
# Usage (from repo root):
#   .\start.ps1
#   powershell -ExecutionPolicy Bypass -File .\start.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$env:PYTHONPATH = Join-Path $Root "backend"

# Load .env into this process (KEY=VALUE lines; comments/blank skipped)
$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { return }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
        Set-Item -Path "Env:$key" -Value $val
    }
}

$ApiPort = if ($env:API_PORT) { [int]$env:API_PORT } else { 8000 }
$UiPort = if ($env:UI_PORT) { [int]$env:UI_PORT } else { 3000 }

function Test-PortListening([int]$Port) {
    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    } catch {
        $lines = netstat -ano 2>$null | Select-String ":$Port\s+.*LISTENING"
        return [bool]$lines
    }
}

function Stop-PortListeners([int]$Port) {
    try {
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            }
    } catch {
        $pids = netstat -ano 2>$null |
            Select-String ":$Port\s+.*LISTENING" |
            ForEach-Object { ($_.ToString() -split '\s+')[-1] } |
            Select-Object -Unique
        foreach ($procId in $pids) {
            if ($procId -match '^\d+$') {
                Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

if (Test-PortListening $UiPort) {
    $UiPort = 3001
    Write-Host "Port 3000 busy - UI will use $UiPort"
}

if (Test-PortListening $ApiPort) {
    Write-Host "Port $ApiPort busy - stopping listener..."
    Stop-PortListeners $ApiPort
    Start-Sleep -Milliseconds 400
}

# Prefer a real Windows venv under .venv\Scripts
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$VenvPip = Join-Path $Root ".venv\Scripts\pip.exe"
$UnixVenvMarker = Join-Path $Root ".venv\bin\python"

function Resolve-HostPython {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        $exe = & py -3 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $exe) {
            return ([string]$exe).Trim()
        }
    }
    foreach ($name in @("python", "python3")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        if ($cmd.Source -match "WindowsApps") { continue }
        return $cmd.Source
    }
    throw "Python 3 not found. Install from https://www.python.org/downloads/ (enable Add python.exe to PATH) or the Windows py launcher."
}

if (-not (Test-Path $VenvPython)) {
    if (Test-Path $UnixVenvMarker) {
        Write-Host "Existing .venv is Unix-style - recreating for Windows..."
        Remove-Item -Recurse -Force (Join-Path $Root ".venv")
    }
    $HostPy = Resolve-HostPython
    Write-Host "Creating .venv with $HostPy ..."
    & $HostPy -m venv (Join-Path $Root ".venv")
    if (-not (Test-Path $VenvPython)) {
        throw "Failed to create Windows venv at .venv\Scripts\python.exe"
    }
    & $VenvPip install -q -r (Join-Path $Root "backend\requirements.txt")
}

$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"

Write-Host ""
Write-Host "Gift City AIF Forwardtester"
Write-Host "  Starting API on 127.0.0.1:$ApiPort ..."

$ApiProc = Start-Process -FilePath $VenvPython `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$ApiPort") `
    -WorkingDirectory $BackendDir `
    -PassThru `
    -WindowStyle Hidden

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "  npm install (frontend)..."
    Push-Location $FrontendDir
    try { npm install } finally { Pop-Location }
}

Write-Host "  Starting UI on 127.0.0.1:$UiPort ..."
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction Stop }
$UiProc = Start-Process -FilePath $npmCmd.Source `
    -ArgumentList @("run", "dev", "--", "--hostname", "127.0.0.1", "--port", "$UiPort") `
    -WorkingDirectory $FrontendDir `
    -PassThru `
    -WindowStyle Hidden

Write-Host ""
Write-Host "  API  http://127.0.0.1:${ApiPort}/docs   (pid $($ApiProc.Id))"
Write-Host "  UI   http://127.0.0.1:${UiPort}        (pid $($UiProc.Id))"
Write-Host ""
Write-Host "Press Ctrl+C to stop both processes."
Write-Host ""

function Stop-Children {
    foreach ($p in @($UiProc, $ApiProc)) {
        if ($null -eq $p) { continue }
        try {
            if (-not $p.HasExited) {
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" -ErrorAction SilentlyContinue |
                    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            }
        } catch { }
    }
    Stop-PortListeners $ApiPort
    Stop-PortListeners $UiPort
}

try {
    while ($true) {
        if ($ApiProc.HasExited -and $UiProc.HasExited) { break }
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host "Shutting down..."
    Stop-Children
}
