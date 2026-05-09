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

$script:PrivateAIProgressLastUtc = [datetime]::MinValue

<#
    Coarse snapshot for Electron main to poll into the Install Wizard (same JSON shape as comfy portable).

    Scripts pass -ProgressFile from the launcher; throttle updates to avoid churn.
#>
function Write-PrivateAIProgressFile {
    param(
        [string]$ProgressFile,
        [Parameter(Mandatory)][string]$Phase,
        [object]$Pct,
        [string]$Detail = ''
    )

    if ([string]::IsNullOrWhiteSpace($ProgressFile)) { return }

    $ph = ([string]$Phase).Trim().ToLowerInvariant()
    if ($ph.Length -gt 64) { $ph = $ph.Substring(0, 64) }
    if ($ph.Length -lt 1) { $ph = 'working' }

    $nowUtc = [datetime]::UtcNow
    # Throttle aggressively: Docker/winget/DISM steps can hammer this and drive disk + Electron polling cost.
    if (($nowUtc - $script:PrivateAIProgressLastUtc).TotalMilliseconds -lt 520) { return }
    $script:PrivateAIProgressLastUtc = $nowUtc

    $pctOut = $null
    if ($null -ne $Pct) {
        try {
            $n = [int]$Pct
            if (($n -ge 0) -and ($n -le 100)) { $pctOut = $n }
        }
        catch { }
    }

    $detailStr = ''
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        $detailStr = [string]$Detail
        if ($detailStr.Length -gt 200) { $detailStr = $detailStr.Substring(0, 200) }
    }

    $obj = [ordered]@{ phase = $ph; pct = $pctOut }
    if (-not [string]::IsNullOrWhiteSpace($detailStr)) {
        $obj.detail = $detailStr
    }

    $json = ($obj | ConvertTo-Json -Compress)
    try {
        Set-Content -LiteralPath $ProgressFile -Value $json -Encoding utf8 -Force
    }
    catch { }
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
    Update-PrivateAIPathFromRegistry

    $fromPath = Get-Command ollama.exe -ErrorAction SilentlyContinue
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

function Get-PrivateAIOllamaVersionLine {
    param([string]$OllamaExePath)
    if ([string]::IsNullOrWhiteSpace($OllamaExePath)) { return $null }
    try {
        $raw = (& $OllamaExePath version *>&1 | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
        $line = ($raw -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1)
        if ([string]::IsNullOrWhiteSpace($line)) { return $null }
        return [string]$line.Trim()
    }
    catch {
        return $null
    }
}

function Start-PrivateAIOllamaIfInstalled {
    $svcNames = @('Ollama', 'ollama')
    foreach ($n in $svcNames) {
        try {
            $s = Get-Service -Name $n -ErrorAction SilentlyContinue
            if ($null -ne $s -and $s.Status -ne 'Running') {
                Start-Service -Name $n -ErrorAction SilentlyContinue | Out-Null
            }
        }
        catch { }
    }

    $exe = Get-OllamaExecutablePath
    if ($null -ne $exe) {
        Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
    }
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

    # Prefer Docker Desktop's bundled CLI. `Get-Command docker.exe` can resolve a stub, another
    # distro's binary, or a broken PATH entry first — then `docker version` never talks to Desktop.
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

    $fromPath = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($null -ne $fromPath) { return [string]$fromPath.Source }

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
    If the canonical container name is missing, find a container publishing $HostPort that looks like Open WebUI
    (image contains open-webui, or name matches privateai-open-webui).
#>
function Resolve-PrivateAIOpenWebUiContainerName {
    param(
        [Parameter(Mandatory)][int]$HostPort,
        [string]$DockerExePath = ''
    )
    try {
        if ([string]::IsNullOrWhiteSpace($DockerExePath)) {
            $DockerExePath = Get-DockerExecutablePath
        }
        if ([string]::IsNullOrWhiteSpace($DockerExePath)) {
            return $null
        }
        $r = Invoke-PrivateAIDocker -DockerExePath $DockerExePath `
            -ArgList @('ps', '-a', '--filter', "publish=$HostPort", '--format', '{{.Names}}\t{{.Image}}') `
            -OutputCharLimit 8000
        if ($r.ExitCode -ne 0) {
            return $null
        }
        $rows = @(
            ($r.Output -split "(`r`n|`n|`r)") |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ -ne '' }
        )
        if ($rows.Count -eq 0) {
            return $null
        }
        $parsed = foreach ($row in $rows) {
            $parts = $row -split "`t", 2
            $nm = $parts[0].Trim()
            $img = if ($parts.Count -gt 1) { $parts[1].Trim() } else { '' }
            [pscustomobject]@{ Name = $nm; Image = $img }
        }
        $exact = $parsed | Where-Object { $_.Name -eq 'privateai-open-webui' } | Select-Object -First 1
        if ($null -ne $exact) {
            return [string]$exact.Name
        }
        $byImg = $parsed | Where-Object { $_.Image -match 'open-webui' } | Select-Object -First 1
        if ($null -ne $byImg) {
            return [string]$byImg.Name
        }
        return [string]$parsed[0].Name
    }
    catch {
        return $null
    }
}

<#
    After the Docker engine is up: if privateai-open-webui exists but is stopped, run docker start.
    Does not throw; returns a small status object for repair / manage-app messaging.
#>
function Start-PrivateAIOpenWebUiContainerIfStopped {
    try {
        $dockerExe = Get-DockerExecutablePath
        if ([string]::IsNullOrWhiteSpace($dockerExe)) {
            return [pscustomobject]@{ ok = $true; action = 'skipped'; reason = 'docker_exe_missing' }
        }
        $ports = Get-PortsConfig
        $hostPort = [int]$ports.openWebui
        $preferred = 'privateai-open-webui'
        $name = $preferred

        $insp = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('inspect', '-f', '{{.State.Running}}', $name) -OutputCharLimit 800
        if ($insp.ExitCode -ne 0) {
            $alt = Resolve-PrivateAIOpenWebUiContainerName -DockerExePath $dockerExe -HostPort $hostPort
            if ([string]::IsNullOrWhiteSpace($alt)) {
                return [pscustomobject]@{ ok = $true; action = 'skipped'; reason = 'container_absent' }
            }
            $name = $alt
            $insp = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('inspect', '-f', '{{.State.Running}}', $name) -OutputCharLimit 800
            if ($insp.ExitCode -ne 0) {
                return [pscustomobject]@{ ok = $true; action = 'skipped'; reason = 'container_absent' }
            }
        }
        $txt = (Get-PrivateAINormalizedConsoleText $insp.Output).Trim()
        if ($txt -match '^\s*true\s*$') {
            return [pscustomobject]@{ ok = $true; action = 'skipped'; reason = 'already_running'; container = $name }
        }
        $st = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('start', $name) -OutputCharLimit 2000
        if ($st.ExitCode -eq 0) {
            return [pscustomobject]@{
                ok         = $true
                action     = 'started'
                reason     = $null
                container  = $name
                outputTail = (Get-PrivateAITailText $st.Output 400)
            }
        }
        return [pscustomobject]@{
            ok         = $false
            action     = 'start_failed'
            reason     = 'docker_start_nonzero'
            container  = $name
            outputTail = (Get-PrivateAITailText $st.Output 800)
        }
    }
    catch {
        return [pscustomobject]@{
            ok     = $false
            action = 'error'
            reason = (Get-PrivateAITailText $_.Exception.Message 500)
        }
    }
}

<#
    Streams `docker pull` output into temp tails and emits Write-PrivateAIProgressFile snapshots.
    Mirrors Start-Process usage in Invoke-PrivateAIDocker under $ErrorActionPreference Stop.
#>
function Invoke-PrivateAIDockerPullWithProgress {
    param(
        [Parameter(Mandatory)][string]$DockerExePath,
        [Parameter(Mandatory)][string]$Image,
        [string]$ProgressFile = '',
        [int]$OutputCharLimit = 12000
    )

    function Read-Tails {
        param([string]$Path)
        if (-not (Test-Path -LiteralPath $Path)) {
            return ''
        }
        try {
            return (Get-Content -LiteralPath $Path -Tail 32 -ErrorAction SilentlyContinue | Out-String)
        }
        catch {
            return ''
        }
    }

    $tid = [Guid]::NewGuid().ToString('n')
    $outF = Join-Path $env:TEMP "privateai-docker-pull-$tid.out"
    $errF = Join-Path $env:TEMP "privateai-docker-pull-$tid.err"
    Remove-Item -LiteralPath $outF, $errF -Force -ErrorAction SilentlyContinue

    $dir = Split-Path -Parent $DockerExePath

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct 8 -Detail 'Docker pull'

    $proc = $null
    try {
        $proc = Start-Process -FilePath $DockerExePath -WorkingDirectory $dir `
            -ArgumentList @('pull', $Image) `
            -PassThru -NoNewWindow `
            -RedirectStandardOutput $outF `
            -RedirectStandardError $errF
    }
    catch {
        Remove-Item -LiteralPath $outF, $errF -Force -ErrorAction SilentlyContinue
        return @{ ExitCode = -1; Output = [string]$_.Exception.Message }
    }

    if ($null -eq $proc) {
        Remove-Item -LiteralPath $outF, $errF -Force -ErrorAction SilentlyContinue
        return @{ ExitCode = -2; Output = 'Start-Process returned null.' }
    }

    $lastPct = $null
    while (-not $proc.HasExited) {
        $proc.Refresh()
        Start-Sleep -Milliseconds 360
        $blob = "$(Read-Tails -Path $outF)`n$(Read-Tails -Path $errF)"

        try {
            $best = $null
            foreach ($m in ([regex]::Matches($blob, '\b(\d+(?:\.\d+)?)%'))) {
                $n = [double]$m.Groups[1].Value
                if ($null -eq $best -or $n -gt $best) { $best = $n }
            }
            if (($null -ne $best) -and ($best -ge 0)) {
                $pClamped = [int][Math]::Min(99, [Math]::Max(8, [Math]::Floor($best)))
                Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct $pClamped -Detail $Image
                $lastPct = $pClamped
            }
            else {
                $lines = @(($blob -split '\r?\n') | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Trim()) })
                $lastLn = ''
                if ($lines.Count -gt 0) { $lastLn = [string]$lines[$lines.Count - 1].Trim() }
                if ($lastLn.Length -gt 0) {
                    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct $lastPct -Detail $lastLn
                }
            }
        }
        catch { }
    }

    try {
        $null = $proc.WaitForExit()
    }
    catch { }

    $exit = 1
    try {
        $exit = [int]$proc.ExitCode
    }
    catch { }

    $merged = ''
    foreach ($f in @($outF, $errF)) {
        if (Test-Path -LiteralPath $f) {
            try {
                $merged += "`n" + [System.IO.File]::ReadAllText($f)
            }
            catch { }
        }
    }
    $merged = $merged.Trim()
    if ($merged.Length -gt $OutputCharLimit) {
        $merged = $merged.Substring(0, $OutputCharLimit) + '…'
    }

    if ($exit -eq 0) {
        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct 100 -Detail $Image
    }

    Remove-Item -LiteralPath $outF, $errF -Force -ErrorAction SilentlyContinue
    return @{ ExitCode = [int]$exit; Output = [string]$merged }
}

<#
    Same technique as Invoke-PrivateAIDockerPullWithProgress: avoid piping ollama.exe under
    $ErrorActionPreference Stop (stderr/progress lines can surface as terminating errors).
#>
function Invoke-PrivateAIOllamaPullWithProgress {
    param(
        [Parameter(Mandatory)][string]$OllamaExePath,
        [Parameter(Mandatory)][string]$Model,
        [string]$ProgressFile = '',
        [int]$OutputCharLimit = 12000
    )

    function Read-PullLogSnippet {
        param(
            [string]$Path1,
            [string]$Path2,
            [int]$TailChars = 24000
        )
        $blob = ''
        foreach ($path in @($Path1, $Path2)) {
            if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) {
                continue
            }
            try {
                $blob += "`n" + [System.IO.File]::ReadAllText($path)
            }
            catch { }
        }
        # Ollama redraws one line with CR; normalize so regex sees all % tokens written so far.
        $norm = (($blob -replace "`r`n", "`n").Replace("`r", "`n")).Trim()
        if ($norm.Length -gt $TailChars) {
            return $norm.Substring($norm.Length - $TailChars)
        }
        return $norm
    }

    function Get-MaxPercentFromBlob {
        param([string]$Blob)
        $best = $null
        foreach ($m in ([regex]::Matches($Blob, '(?<!\d)(\d+(?:\.\d+)?)\s*%'))) {
            try {
                $n = [double]$m.Groups[1].Value
                if (($n -lt 0) -or ($n -gt 100)) { continue }
                if ($null -eq $best -or $n -gt $best) { $best = $n }
            }
            catch { }
        }
        return $best
    }

    $tid = [Guid]::NewGuid().ToString('n')
    $outF = Join-Path $env:TEMP "privateai-ollama-pull-$tid.out"
    $errF = Join-Path $env:TEMP "privateai-ollama-pull-$tid.err"
    Remove-Item -LiteralPath $outF, $errF -Force -ErrorAction SilentlyContinue

    $dir = Split-Path -Parent $OllamaExePath
    if ([string]::IsNullOrWhiteSpace($dir)) { $dir = $env:SystemRoot }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct 4 -Detail "Pull $Model"

    $proc = $null
    try {
        $proc = Start-Process -FilePath $OllamaExePath -WorkingDirectory $dir `
            -ArgumentList @('pull', $Model) `
            -PassThru -NoNewWindow `
            -RedirectStandardOutput $outF `
            -RedirectStandardError $errF
    }
    catch {
        Remove-Item -LiteralPath $outF, $errF -Force -ErrorAction SilentlyContinue
        return @{ ExitCode = -1; Output = [string]$_.Exception.Message }
    }

    if ($null -eq $proc) {
        Remove-Item -LiteralPath $outF, $errF -Force -ErrorAction SilentlyContinue
        return @{ ExitCode = -2; Output = 'Start-Process returned null.' }
    }

    $pullT0 = Get-Date
    $lastPct = $null
    while (-not $proc.HasExited) {
        $proc.Refresh()
        Start-Sleep -Milliseconds 360

        $blob = Read-PullLogSnippet -Path1 $outF -Path2 $errF

        try {
            $best = Get-MaxPercentFromBlob -Blob $blob

            $elapsed = ((Get-Date) - $pullT0).TotalSeconds
            # If the CLI never prints a % (TTY progress does not translate to the log), still move the bar.
            $synthPct = $null
            if ($null -eq $best) {
                $synthPct = [int][Math]::Min(94, [Math]::Floor((4 + (($elapsed / 900.0) * 85)))) # ~15 min to upper 80s
            }

            $pEmit = if ($null -ne $best) {
                [int][Math]::Min(99, [Math]::Max(4, [Math]::Floor([double]$best)))
            }
            else {
                $synthPct
            }

            if ($null -ne $pEmit) {
                $lastPct = $pEmit
            }

            $lines = @(($blob -split "`n") | Where-Object { -not [string]::IsNullOrWhiteSpace(($_.Trim())) })
            $lastLn = ''
            if ($lines.Count -gt 0) { $lastLn = [string]$lines[$lines.Count - 1].Trim() }

            $detailOut = if (-not [string]::IsNullOrWhiteSpace($lastLn)) {
                if ($lastLn.Length -gt 160) { $lastLn.Substring($lastLn.Length - 160) } else { $lastLn }
            }
            else {
                "Pull $Model"
            }

            if ($null -ne $pEmit) {
                Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct $pEmit -Detail $detailOut
            }
        }
        catch { }
    }

    try {
        $null = $proc.WaitForExit()
    }
    catch { }

    $exit = 1
    try {
        $exit = [int]$proc.ExitCode
    }
    catch { }

    $merged = ''
    foreach ($f in @($outF, $errF)) {
        if (Test-Path -LiteralPath $f) {
            try {
                $merged += "`n" + [System.IO.File]::ReadAllText($f)
            }
            catch { }
        }
    }
    $merged = $merged.Trim()
    if ($merged.Length -gt $OutputCharLimit) {
        $merged = $merged.Substring(0, $OutputCharLimit) + '…'
    }

    if ($exit -eq 0) {
        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct 100 -Detail $Model
    }

    Remove-Item -LiteralPath $outF, $errF -Force -ErrorAction SilentlyContinue
    return @{ ExitCode = [int]$exit; Output = [string]$merged }
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

    function Read-FirstNonEmptyLine {
        param([string]$Text)
        foreach ($line in ($Text -split "`n")) {
            $trim = $line.Trim()
            if (-not [string]::IsNullOrWhiteSpace($trim)) { return $trim }
        }
        return $null
    }

    $rFmt = Invoke-PrivateAIDocker -DockerExePath $DockerExePath `
        -ArgList @('version', '--format', '{{.Server.Version}}') `
        -OutputCharLimit $OutputCharLimit
    if (($null -ne $rFmt) -and ([int]$rFmt.ExitCode -eq 0)) {
        $line = Read-FirstNonEmptyLine -Text ([string]$rFmt.Output)
        if (-not [string]::IsNullOrWhiteSpace($line)) { return $line }
    }

    $rInfo = Invoke-PrivateAIDocker -DockerExePath $DockerExePath `
        -ArgList @('info', '--format', '{{.ServerVersion}}') `
        -OutputCharLimit $OutputCharLimit
    if (($null -ne $rInfo) -and ([int]$rInfo.ExitCode -eq 0)) {
        $line = Read-FirstNonEmptyLine -Text ([string]$rInfo.Output)
        if (-not [string]::IsNullOrWhiteSpace($line)) { return $line }
    }

    $rVer = Invoke-PrivateAIDocker -DockerExePath $DockerExePath `
        -ArgList @('version') `
        -OutputCharLimit $OutputCharLimit
    if (($null -eq $rVer) -or ([int]$rVer.ExitCode -ne 0)) {
        return $null
    }
    $txt = [string]$rVer.Output
    $needle = "`nServer:"
    $p = $txt.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase)
    if ($p -lt 0) {
        $p = $txt.IndexOf('Server:', [System.StringComparison]::OrdinalIgnoreCase)
    }
    if ($p -ge 0) {
        $tail = $txt.Substring($p)
        if ($tail -match '(?m)Version:\s*([0-9][0-9A-Za-z._\-]*)') {
            return [string]$Matches[1]
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

