param(
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Wait-PrivateAIDockerEngineVersion {
    param(
        [Parameter(Mandatory)][string]$DockerExePath,
        [int]$DeadlineSeconds = 150,
        [int]$IntervalSeconds = 10,
        [string]$ProgressFileInner = '',
        [string]$ProgressDetail = 'Docker engine warming up'
    )
    $until = (Get-Date).AddSeconds($DeadlineSeconds)
    $started = Get-Date
    while ((Get-Date) -lt $until) {
        $v = Get-PrivateAIDockerServerVersion -DockerExePath $DockerExePath
        if (-not [string]::IsNullOrWhiteSpace($v)) {
            return [string]$v
        }
        try {
            $elapsed = ((Get-Date) - $started).TotalSeconds
            $pct = [int][Math]::Min(
                94,
                [Math]::Floor(($elapsed / [double]([Math]::Max(10, $DeadlineSeconds))) * 100)
            )
            Write-PrivateAIProgressFile -ProgressFile $ProgressFileInner -Phase check `
                -Pct $pct `
                -Detail $ProgressDetail
        }
        catch { }
        Start-Sleep -Seconds $IntervalSeconds
    }
    return $null
}

try {
    $dockerExe = Get-DockerExecutablePath
    if ([string]::IsNullOrWhiteSpace($dockerExe)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker is not installed or not on PATH.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'DOCKER_NOT_FOUND'; message = 'docker.exe not found' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 10 -Detail 'First engine probe'

    # Cold start: linuxEngine named pipe often returns HTTP 500 for ~1–3 minutes while VM boots.
    $version = Wait-PrivateAIDockerEngineVersion -DockerExePath $dockerExe -DeadlineSeconds 150 -IntervalSeconds 10 `
        -ProgressFileInner $ProgressFile -ProgressDetail 'Waiting for Docker engine (initial)'
    if (-not [string]::IsNullOrWhiteSpace($version)) {
        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 100 -Detail 'Engine responded'
        $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker is installed and responding.' -Details @{
            serverVersion = [string]$version
            dockerExe     = [string]$dockerExe
        }
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }

    $probeFail = Invoke-PrivateAIDocker -DockerExePath $dockerExe `
        -ArgList @('version', '--format', '{{.Server.Version}}') -OutputCharLimit 2000

    $firstErr = if ($probeFail.Output.Length -gt 0) {
        ([string]$probeFail.Output).Trim()
    }
    else {
        'Docker server version unavailable after initial wait.'
    }

    # Do not run wsl --update / wsl --shutdown from this script: it is disruptive on some PCs and belongs
    # under Troubleshooting (repair WSL_UPDATE) or the elevated Docker install path.
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 55 -Detail 'Starting Docker service / Desktop'

    $dockEng = Start-PrivateAIDockerWindowsEngine
    $version3 = Wait-PrivateAIDockerEngineVersion -DockerExePath $dockerExe -DeadlineSeconds 120 -IntervalSeconds 10 `
        -ProgressFileInner $ProgressFile -ProgressDetail 'After service/desktop start'
    if (-not [string]::IsNullOrWhiteSpace($version3)) {
        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 100 -Detail 'Engine responded'
        $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker responded after starting Docker Desktop service / app.' -Details @{
            serverVersion = [string]$version3
            dockerExe     = [string]$dockerExe
            dockerEngine  = $dockEng
            recoveryNote  = 'Started com.docker.service and/or Docker Desktop; extra wait before the engine answered is normal on a cold install.'
        }
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }

    $failMsg = @'
Docker engine did not respond in time after starting the Windows service / Desktop.

Wait until the Docker tray icon is steady, open Docker Desktop once, then run this step again.

If Docker says WSL needs updating, open Troubleshooting in this launcher and run "WSL: update kernel (admin)" (repair code WSL_UPDATE), then return here. The Install wizard no longer runs wsl --update or wsl --shutdown automatically.
'@.Trim()

    if (-not $dockEng.serviceFound) {
        $failMsg = 'Docker CLI is present but com.docker.service was not found (incomplete install?). Reinstall Docker Desktop from Settings - Apps or docker.com.'
    }

    $payload = New-ScriptResult -Ok $false -Status error -Message $failMsg -Details @{
        dockerEngine    = $dockEng
        dockerProbeTail = $probeFail.Output
        dockerProbeExit = $probeFail.ExitCode
        repairHint      = 'Troubleshooting: WSL_UPDATE (WSL kernel) or DOCKER_ENGINE_WINDOWS (service + Desktop).'
    } -Errors @(
        [pscustomobject]@{ code = 'DOCKER_NOT_RUNNING'; message = [string]$firstErr }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker check failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'DOCKER_CHECK_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
