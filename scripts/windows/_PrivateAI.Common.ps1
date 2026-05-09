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

<#
    Ollama winget/user install often lands in LOCALAPPDATA\Programs\Ollama,
    which Electron-spawned PowerShell may not have on PATH — always probe known paths.
#>
function Get-OllamaExecutablePath {
    $fromPath = Get-Command ollama -ErrorAction SilentlyContinue
    if ($null -ne $fromPath) { return [string]$fromPath.Source }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
    )
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if (-not [string]::IsNullOrWhiteSpace($pf86)) {
        $candidates += (Join-Path $pf86 'Ollama\ollama.exe')
    }

    foreach ($p in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($p) -and (Test-Path -LiteralPath $p)) {
            return [string]$p
        }
    }
    return $null
}

function Update-PrivateAIPathFromRegistry {
    $m = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    if ([string]::IsNullOrWhiteSpace($m) -and [string]::IsNullOrWhiteSpace($u)) {
        return
    }
    $env:Path = @(
        @($m, $u) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    ) -join ';'
}

function Get-DockerExecutablePath {
    Update-PrivateAIPathFromRegistry

    $fromPath = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($null -ne $fromPath) { return [string]$fromPath.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\resources\docker.exe')
    )
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if (-not [string]::IsNullOrWhiteSpace($pf86)) {
        $candidates += (Join-Path $pf86 'Docker\Docker\resources\bin\docker.exe')
    }

    foreach ($p in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($p) -and (Test-Path -LiteralPath $p)) {
            return [string]$p
        }
    }

    # Layout changes between Docker Desktop builds — shallow search under Program Files\Docker
    $dockerRoot = Join-Path $env:ProgramFiles 'Docker'
    if (Test-Path -LiteralPath $dockerRoot) {
        $hit = Get-ChildItem -LiteralPath $dockerRoot -Filter 'docker.exe' -File -Recurse -Depth 8 -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $hit) {
            return [string]$hit.FullName
        }
    }
    return $null
}
