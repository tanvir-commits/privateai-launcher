param(
    [switch]$StartDev
)

# Docker writes to stderr; do not treat native stderr as terminating errors.
$ErrorActionPreference = 'Continue'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
}

function Test-TcpPortOpen {
    param([int]$Port)
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $Port)
        $ok = $c.Connected
        $c.Close()
        return $ok
    }
    catch {
        return $false
    }
}

function Wait-OpenWebUiHttp {
    param([int]$Port = 3000, [int]$Attempts = 50, [int]$DelaySec = 2)
    $paths = @('/health', '/api/health', '/')
    for ($i = 0; $i -lt $Attempts; $i++) {
        foreach ($path in $paths) {
            $url = if ($path -eq '/') { "http://127.0.0.1:$Port/" } else { "http://127.0.0.1:$Port$path" }
            try {
                $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 6 -ErrorAction Stop
                if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
                    return $true
                }
            }
            catch { }
        }
        Start-Sleep -Seconds $DelaySec
    }
    return $false
}

function Get-LastJsonObject([string]$Text) {
    $line = ($Text -split "(`r`n|`n)") | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($line)) {
        throw 'No JSON object line in script output.'
    }
    return ($line.Trim() | ConvertFrom-Json)
}

Write-Step 'Docker engine'
docker version --format '{{.Server.Version}}' 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'docker CLI failed. Start Docker Desktop.'
}

$name = 'privateai-open-webui'
$needsInstall = $false

Write-Step "Container $name"
$insp = docker inspect $name 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Not present — will run install-openwebui.ps1.'
    $needsInstall = $true
}
else {
    $status = (docker inspect $name --format '{{.State.Status}}' 2>&1).Trim()
    $logs = (docker logs --tail 12 $name 2>&1 | Out-String)
    Write-Host "State: $status"
    if ($status -eq 'restarting' -or $logs -match 'exec format error') {
        Write-Host 'Unhealthy (restart loop or exec format) — removing and reinstalling.'
        docker rm -f $name 2>&1 | Out-Null
        $needsInstall = $true
    }
}

if ($needsInstall) {
    Write-Step 'install-openwebui.ps1'
    $installOut = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\windows\install-openwebui.ps1') 2>&1 | Out-String
    Write-Host ($installOut.TrimEnd())
    $inst = Get-LastJsonObject -Text $installOut
    if (-not $inst.ok) {
        throw "install-openwebui.ps1 failed: $($inst.message)"
    }
}

Write-Step 'Wait for Open WebUI HTTP (port 3000)'
if (-not (Wait-OpenWebUiHttp -Port 3000)) {
    throw 'Open WebUI did not become HTTP-reachable on port 3000 in time.'
}
Write-Host 'HTTP OK on port 3000.'

Write-Step 'health-check.ps1'
$hcOut = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\windows\health-check.ps1') 2>&1 | Out-String
$hc = Get-LastJsonObject -Text $hcOut
if (-not $hc.ok) {
    Write-Host ($hcOut.TrimEnd())
}
if (-not $hc.details.openWebui.httpProbeOk) {
    throw "health-check reports openWebui.httpProbeOk=false. Message: $($hc.message)"
}
if (-not $hc.details.ollama.running) {
    throw 'health-check reports Ollama not running; start Ollama then re-run verify-local-stack.ps1.'
}
Write-Host "health-check: openWebui.httpProbeOk=true; core ok=$($hc.ok)"

if ($StartDev) {
    Write-Step 'Dev server (Electron + Vite)'
    if (Test-TcpPortOpen -Port 5173) {
        Write-Host 'Port 5173 already open — skip npm run dev (leave existing dev server running).'
    }
    else {
        $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
        Start-Process -FilePath $npm -ArgumentList @('run', 'dev') -WorkingDirectory $repoRoot -WindowStyle Minimized
        Write-Host 'Started npm run dev in a new minimized window.'
    }
}

Write-Host ''
Write-Host 'verify-local-stack: OK' -ForegroundColor Green
exit 0
