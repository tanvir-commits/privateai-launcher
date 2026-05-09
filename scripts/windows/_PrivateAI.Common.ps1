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
    Run docker.exe with stdout/stderr captured via temp files.

    PrivateAI scripts use $ErrorActionPreference = 'Stop'. Windows PowerShell 5 maps docker CLI
    stderr (e.g. `docker inspect` when a container is missing) to terminating NativeCommandError
    even when using 2>&1. Start-Process redirection avoids that so callers can use ExitCode.
#>
function Invoke-PrivateAIDocker {
    param(
        [Parameter(Mandatory)][string[]]$ArgList,
        [int]$OutputCharLimit = 8000,
        [string]$DockerExePath = ''
    )
    if ([string]::IsNullOrWhiteSpace($DockerExePath)) {
        $DockerExePath = Get-DockerExecutablePath
        if ([string]::IsNullOrWhiteSpace($DockerExePath)) {
            throw 'docker.exe not found (PATH / Docker Desktop install).'
        }
    }

    $fileId = [Guid]::NewGuid().ToString('n')
    $outPath = Join-Path $env:TEMP "privateai-docker-$fileId-out.txt"
    $errPath = Join-Path $env:TEMP "privateai-docker-$fileId-err.txt"
    Remove-Item -LiteralPath $outPath, $errPath -Force -ErrorAction SilentlyContinue
    try {
        $p = Start-Process -FilePath $DockerExePath -ArgumentList $ArgList `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $outPath `
            -RedirectStandardError $errPath
        $exit = [int]$p.ExitCode
        $outTxt = if (Test-Path -LiteralPath $outPath) { [System.IO.File]::ReadAllText($outPath) } else { '' }
        $errTxt = if (Test-Path -LiteralPath $errPath) { [System.IO.File]::ReadAllText($errPath) } else { '' }
        $merged = (($outTxt + "`n" + $errTxt).Trim())
        if ($merged.Length -gt $OutputCharLimit) {
            $merged = $merged.Substring(0, $OutputCharLimit) + '…'
        }
        return @{ ExitCode = [int]$exit; Output = [string]$merged }
    }
    finally {
        Remove-Item -LiteralPath $outPath, $errPath -Force -ErrorAction SilentlyContinue
    }
}

<#
    Runs `docker version --format '{{.Server.Version}}'` without tripping NativeCommandError under
    $ErrorActionPreference Stop. Returns trimmed server version text, or $null if the engine is not ready.
#>
function Get-PrivateAIDockerServerVersion {
    param(
        [Parameter(Mandatory)][string]$DockerExePath,
        [int]$OutputCharLimit = 4000
    )
    $r = Invoke-PrivateAIDocker -DockerExePath $DockerExePath `
        -ArgList @('version', '--format', '{{.Server.Version}}') `
        -OutputCharLimit $OutputCharLimit
    if (($null -eq $r) -or ([int]$r.ExitCode -ne 0)) {
        return $null
    }
    foreach ($line in (([string]$r.Output) -split "`n")) {
        $trim = $line.Trim()
        if (-not [string]::IsNullOrWhiteSpace($trim)) {
            return $trim
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

function Get-PrivateAITailText {
    param([string]$Text, [int]$MaxLen = 2000)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    if ($Text.Length -le $MaxLen) { return $Text }
    return $Text.Substring($Text.Length - $MaxLen)
}

function Get-PrivateAINormalizedConsoleText {
    param([AllowNull()][string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    # wsl.exe often emits UTF-16-style output; piping through Out-String can leave U+0000 between ASCII chars.
    return ([regex]::Replace($Text, '\x00', '')).Trim()
}

<#
    Updates the WSL inbox package (fixes Docker "WSL needs updating"). Prefer --web-download when Store is missing.
    Run elevated when possible. Requires WSL optional components to be enabled (may need reboot after DISM first).
#>
function Stop-PrivateAIWsl {
    $wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
    if (-not (Test-Path -LiteralPath $wsl)) { return }
    try {
        $null = & $wsl --shutdown 2>&1
    }
    catch { }
}

function Start-PrivateAIDockerWindowsEngine {
    param(
        [switch]$SkipLaunchDesktop
    )

    $svcName = 'com.docker.service'
    $found = $false
    $before = ''
    $after = ''
    $startOk = $false
    $errMsg = ''
    try {
        $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
        if ($null -ne $svc) {
            $found = $true
            $before = [string]$svc.Status
            if ($svc.Status -ne 'Running') {
                Start-Service -Name $svcName -ErrorAction Stop
            }
            $svc2 = Get-Service -Name $svcName
            $after = [string]$svc2.Status
            $startOk = ($svc2.Status -eq 'Running')
        }
    }
    catch {
        $errMsg = $_.Exception.Message
    }

    $launched = $false
    if (-not $SkipLaunchDesktop) {
        $exe = Get-DockerDesktopExePath
        if ($null -ne $exe -and (Test-Path -LiteralPath $exe)) {
            try {
                Start-Process -FilePath $exe -ErrorAction SilentlyContinue | Out-Null
                $launched = $true
            }
            catch { }
        }
    }

    return [pscustomobject]@{
        serviceName        = $svcName
        serviceFound       = [bool]$found
        statusBefore       = $before
        statusAfter        = $after
        serviceRunning     = [bool]$startOk
        startError         = $errMsg
        desktopLaunched    = [bool]$launched
    }
}

function Update-PrivateAIWslInPlace {
    $wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
    if (-not (Test-Path -LiteralPath $wsl)) {
        return [pscustomobject]@{
            ok       = $false
            method   = 'none'
            exitCode = -1
            version  = ''
            tail     = 'wsl.exe not found under System32.'
        }
    }

    $verOut = ''
    try {
        $verOut = Get-PrivateAINormalizedConsoleText (& $wsl --version 2>&1 | Out-String)
    }
    catch { }

    $outWeb = ''
    try {
        $outWeb = (& $wsl --update --web-download 2>&1 | Out-String)
    }
    catch {
        $outWeb = [string]$_.Exception.Message
    }
    $outWeb = Get-PrivateAINormalizedConsoleText $outWeb
    $ecWeb = $LASTEXITCODE
    if ($ecWeb -eq 0) {
        try {
            $null = (& $wsl --set-default-version 2 2>&1 | Out-String)
        }
        catch { }
        Stop-PrivateAIWsl
        try {
            $verOut = Get-PrivateAINormalizedConsoleText (& $wsl --version 2>&1 | Out-String)
        }
        catch { }
        return [pscustomobject]@{
            ok       = $true
            method   = 'web-download'
            exitCode = 0
            version  = $verOut
            tail     = (Get-PrivateAITailText -Text $outWeb -MaxLen 1200)
        }
    }

    $outDef = ''
    try {
        $outDef = (& $wsl --update 2>&1 | Out-String)
    }
    catch {
        $outDef = [string]$_.Exception.Message
    }
    $outDef = Get-PrivateAINormalizedConsoleText $outDef
    $ecDef = $LASTEXITCODE
    if ($ecDef -eq 0) {
        try {
            $null = (& $wsl --set-default-version 2 2>&1 | Out-String)
        }
        catch { }
        Stop-PrivateAIWsl
        try {
            $verOut = Get-PrivateAINormalizedConsoleText (& $wsl --version 2>&1 | Out-String)
        }
        catch { }
        return [pscustomobject]@{
            ok       = $true
            method   = 'default'
            exitCode = 0
            version  = $verOut
            tail     = (Get-PrivateAITailText -Text $outDef -MaxLen 1200)
        }
    }

    $combined = "web-download exit $ecWeb`n$(Get-PrivateAITailText -Text $outWeb -MaxLen 1200)`n--update exit $ecDef`n$(Get-PrivateAITailText -Text $outDef -MaxLen 1200)"
    return [pscustomobject]@{
        ok       = $false
        method   = 'failed'
        exitCode = $ecDef
        version  = $verOut
        tail     = (Get-PrivateAITailText -Text (Get-PrivateAINormalizedConsoleText $combined) -MaxLen 2500)
    }
}

