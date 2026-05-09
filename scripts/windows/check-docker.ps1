. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Wait-PrivateAIDockerEngineVersion {
    param(
        [Parameter(Mandatory)][string]$DockerExePath,
        [int]$DeadlineSeconds = 150,
        [int]$IntervalSeconds = 10
    )
    $until = (Get-Date).AddSeconds($DeadlineSeconds)
    while ((Get-Date) -lt $until) {
        $v = Get-PrivateAIDockerServerVersion -DockerExePath $DockerExePath
        if (-not [string]::IsNullOrWhiteSpace($v)) {
            return [string]$v
        }
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

    # Cold start / post-WSL-reset: linuxEngine named pipe often returns HTTP 500 for ~1–3 minutes while VM boots.
    $version = Wait-PrivateAIDockerEngineVersion -DockerExePath $dockerExe -DeadlineSeconds 150 -IntervalSeconds 10
    if (-not [string]::IsNullOrWhiteSpace($version)) {
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

    $wslHeal = Update-PrivateAIWslInPlace
    Stop-PrivateAIWsl
    Start-Sleep -Seconds 3
    $version2 = Wait-PrivateAIDockerEngineVersion -DockerExePath $dockerExe -DeadlineSeconds 90 -IntervalSeconds 8
    if (-not [string]::IsNullOrWhiteSpace($version2)) {
        $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker is responding after WSL refresh.' -Details @{
            serverVersion = [string]$version2
            dockerExe     = [string]$dockerExe
            wslHeal       = $wslHeal
        } -Warnings @('Ran wsl --update / wsl --shutdown and retried; if Docker UI still says WSL is old, restart Windows once or run Troubleshooting - WSL update (admin).')
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }

    $dockEng = Start-PrivateAIDockerWindowsEngine
    $version3 = Wait-PrivateAIDockerEngineVersion -DockerExePath $dockerExe -DeadlineSeconds 120 -IntervalSeconds 10
    if (-not [string]::IsNullOrWhiteSpace($version3)) {
        $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker responded after starting Docker Desktop service / app.' -Details @{
            serverVersion = [string]$version3
            dockerExe     = [string]$dockerExe
            wslHeal       = $wslHeal
            dockerEngine  = $dockEng
        } -Warnings @('We started com.docker.service and relaunched Docker Desktop; engine needed extra time beyond the first wait.')
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }

    $failMsg = 'Docker is installed but the engine is not responding after WSL refresh and Windows service start. If you just installed or updated Docker, wait until the tray icon is ready, open Docker Desktop once, then run this step again.'
    if ($wslHeal.ok -and ($null -ne $wslHeal.tail) -and ($wslHeal.tail -match 'already')) {
        $failMsg = 'WSL looks current, but the Docker engine still will not answer. Try Troubleshooting - Docker engine (Windows service). If com.docker.service stays stopped, reinstall Docker Desktop or restart Windows once.'
    }
    if (-not $dockEng.serviceFound) {
        $failMsg = 'Docker CLI is present but com.docker.service was not found (incomplete install?). Reinstall Docker Desktop from Settings - Apps or docker.com.'
    }

    $payload = New-ScriptResult -Ok $false -Status error -Message $failMsg -Details @{
        wslHeal          = $wslHeal
        dockerEngine     = $dockEng
        dockerProbeTail  = $probeFail.Output
        dockerProbeExit  = $probeFail.ExitCode
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
