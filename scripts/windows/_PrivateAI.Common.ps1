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

function Get-DockerDesktopExePath {
    $standard = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path -LiteralPath $standard) { return [string]$standard }

    $roots = @(
        (Join-Path $env:ProgramFiles 'Docker'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Docker')
    )
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if (-not [string]::IsNullOrWhiteSpace($pf86)) {
        $roots += (Join-Path $pf86 'Docker')
    }

    foreach ($root in $roots) {
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root)) {
            continue
        }
        $hit = Get-ChildItem -LiteralPath $root -Filter 'Docker Desktop.exe' -File -Recurse -Depth 9 -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $hit) { return [string]$hit.FullName }
    }
    return $null
}

function Get-DockerExecutablePath {
    Update-PrivateAIPathFromRegistry

    $fromPath = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($null -ne $fromPath) { return [string]$fromPath.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\resources\docker.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\resources\bin\docker.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\resources\docker.exe')
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

    # Layout changes / per-user winget — shallow search under Docker roots
    foreach ($root in @(
            (Join-Path $env:ProgramFiles 'Docker'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Docker')
        )) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $hit = Get-ChildItem -LiteralPath $root -Filter 'docker.exe' -File -Recurse -Depth 9 -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $hit) {
            return [string]$hit.FullName
        }
    }
    return $null
}

<#
    Docker Desktop fails with "ProgramData\DockerDesktop must be owned by an elevated account"
    when the folder exists with wrong ownership. Call from an elevated session before install.
#>
function Repair-DockerProgramDataFolder {
    $folder = Join-Path $env:ProgramData 'DockerDesktop'
    if (-not (Test-Path -LiteralPath $folder)) {
        return [pscustomobject]@{
            ok     = $true
            action = 'skipped'
            detail = 'DockerDesktop folder not present under ProgramData.'
        }
    }

    $takeownExe = Join-Path $env:SystemRoot 'System32\takeown.exe'
    $icaclsExe = Join-Path $env:SystemRoot 'System32\icacls.exe'
    if (-not (Test-Path -LiteralPath $takeownExe) -or -not (Test-Path -LiteralPath $icaclsExe)) {
        return [pscustomobject]@{
            ok     = $false
            action = 'error'
            detail = 'takeown.exe or icacls.exe not found under SystemRoot.'
        }
    }

    $p1 = Start-Process -FilePath $takeownExe -ArgumentList @('/F', $folder, '/A', '/R', '/D', 'Y') -Wait -PassThru -NoNewWindow
    $p2 = Start-Process -FilePath $icaclsExe -ArgumentList @($folder, '/grant:r', 'Administrators:(OI)(CI)F', '/T') -Wait -PassThru -NoNewWindow
    $p3 = Start-Process -FilePath $icaclsExe -ArgumentList @($folder, '/grant:r', 'SYSTEM:(OI)(CI)F', '/T') -Wait -PassThru -NoNewWindow

    $t1 = if ($null -ne $p1.ExitCode) { [int]$p1.ExitCode } else { -1 }
    $t2 = if ($null -ne $p2.ExitCode) { [int]$p2.ExitCode } else { -1 }
    $t3 = if ($null -ne $p3.ExitCode) { [int]$p3.ExitCode } else { -1 }

    $ok = ($t1 -eq 0) -and ($t2 -eq 0) -and ($t3 -eq 0)
    return [pscustomobject]@{
        ok            = [bool]$ok
        action        = 'repaired'
        takeownExit   = $t1
        icaclsAdmExit = $t2
        icaclsSysExit = $t3
        folder        = [string]$folder
    }
}

<#
    Enables Windows optional features Docker Desktop / WSL2 needs (no BIOS access from software).
    Requires admin. DISM exit 3010 = reboot required before kernel picks up changes.
#>
function Enable-PrivateAIDockerWindowsOptionalFeatures {
    $dism = Join-Path $env:SystemRoot 'System32\dism.exe'
    if (-not (Test-Path -LiteralPath $dism)) {
        return [pscustomobject]@{
            ok            = $false
            rebootNeeded  = $false
            logLines      = @('dism.exe not found')
            failedFeature = $null
            lastExitCode  = -1
        }
    }

    $featureNames = @(
        'Microsoft-Windows-Subsystem-Linux',
        'VirtualMachinePlatform'
    )

    $log = [System.Collections.Generic.List[string]]::new()
    $reboot = $false

    foreach ($fn in $featureNames) {
        $procArgs = @('/Online', '/Enable-Feature', "/FeatureName:$fn", '/All', '/NoRestart')
        $p = Start-Process -FilePath $dism -ArgumentList $procArgs -Wait -PassThru -NoNewWindow
        $ec = if ($null -ne $p.ExitCode) { [int]$p.ExitCode } else { -1 }
        [void]$log.Add("${fn}: dism exit $ec")
        if ($ec -eq 3010) {
            $reboot = $true
        }
        elseif ($ec -ne 0) {
            return [pscustomobject]@{
                ok            = $false
                rebootNeeded  = $reboot
                logLines      = @($log.ToArray())
                failedFeature = [string]$fn
                lastExitCode  = $ec
            }
        }
    }

    return [pscustomobject]@{
        ok           = $true
        rebootNeeded = [bool]$reboot
        logLines     = @($log.ToArray())
        failedFeature = $null
        lastExitCode  = 0
    }
}

