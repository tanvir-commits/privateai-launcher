$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# Intentionally excludes install-openwebui.ps1 (Docker side effects) from automated smoke.
$scripts = @(
    'check-system.ps1',
    'check-gpu.ps1',
    'check-ollama.ps1',
    'check-docker.ps1',
    'check-comfyui.ps1',
    'install-ollama.ps1',
    'install-comfyui.ps1',
    'configure-openwebui.ps1',
    'configure-comfyui.ps1',
    'health-check.ps1',
    'repair.ps1'
)

function Test-JsonLine {
    param([string]$Text)
    $parsed = $Text.Trim().Split("`n") | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($parsed)) { throw 'No JSON line detected' }
    $obj = $parsed | ConvertFrom-Json
    if ($null -eq $obj.ok) { throw 'Missing ok' }
    if ($null -eq $obj.status) { throw 'Missing status' }
    if ($null -eq $obj.message) { throw 'Missing message' }
    if ($null -eq $obj.details) { throw 'Missing details' }
    if ($null -eq $obj.warnings) { throw 'Missing warnings' }
    if ($null -eq $obj.errors) { throw 'Missing errors' }
}

$failed = 0
foreach ($s in $scripts) {
    Write-Host "==> $s"
    try {
        if ($s -eq 'repair.ps1') {
            $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $s) -Code PORT_BUSY 2>&1
        }
        else {
            $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $s) 2>&1
        }
        $text = ($out | Out-String)
        Test-JsonLine -Text $text
        Write-Host "OK"
    }
    catch {
        Write-Host "FAIL: $($_.Exception.Message)"
        $failed++
    }
}

if ($failed -gt 0) {
    exit 1
}
exit 0
