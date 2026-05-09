Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PrivateAiRepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Get-PortsConfig {
    $portsPath = Join-Path (Get-PrivateAiRepoRoot) 'config\ports.json'
    if (-not (Test-Path $portsPath)) {
        return [pscustomobject]@{ ollama = 11434; openWebui = 3000; comfyui = 8188 }
    }
    return (Get-Content -LiteralPath $portsPath -Raw | ConvertFrom-Json)
}

function New-ScriptResult {
    param(
        [bool]$Ok,
        [ValidateSet('success', 'warning', 'error', 'pending', 'running')][string]$Status,
        [string]$Message,
        [object]$Details = @{},
        [string[]]$Warnings = @(),
        [object[]]$Errors = @()
    )

    return [pscustomobject]@{
        ok        = [bool]$Ok
        status    = [string]$Status
        message   = [string]$Message
        details   = $Details
        warnings  = @($Warnings)
        errors    = @($Errors)
    }
}

function Write-ScriptJson {
    param([Parameter(Mandatory)][object]$Payload)
    ($Payload | ConvertTo-Json -Compress -Depth 25)
}

function Test-TcpPortFree {
    param([int]$Port)
    try {
        $c = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        return ($null -eq $c)
    }
    catch {
        return $true
    }
}
