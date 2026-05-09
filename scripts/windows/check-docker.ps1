. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $dockerExe = Get-DockerExecutablePath
    if ($null -eq $dockerExe) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker is not installed or not on PATH.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'DOCKER_NOT_FOUND'; message = 'docker.exe not found' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    try {
        $version = & $dockerExe version --format '{{.Server.Version}}' 2>$null
        if ([string]::IsNullOrWhiteSpace($version)) {
            throw 'Docker server version unavailable (is Docker Desktop running?)'
        }

        $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker is installed and responding.' -Details @{
            serverVersion = [string]$version
            dockerExe     = [string]$dockerExe
        }
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }
    catch {
        $firstErr = $_.Exception.Message
        $wslHeal = Update-PrivateAIWslInPlace
        Stop-PrivateAIWsl
        Start-Sleep -Seconds 3
        try {
            $version2 = & $dockerExe version --format '{{.Server.Version}}' 2>$null
            if (-not [string]::IsNullOrWhiteSpace($version2)) {
                $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker is responding after WSL refresh.' -Details @{
                    serverVersion = [string]$version2
                    dockerExe     = [string]$dockerExe
                    wslHeal       = $wslHeal
                } -Warnings @('Ran wsl --update / wsl --shutdown and retried; if Docker UI still says WSL is old, restart Windows once or run Troubleshooting - WSL update (admin).')
                Write-Output (Write-ScriptJson $payload)
                exit 0
            }
        }
        catch { }

        $dockEng = Start-PrivateAIDockerWindowsEngine
        Start-Sleep -Seconds 8
        try {
            $version3 = & $dockerExe version --format '{{.Server.Version}}' 2>$null
            if (-not [string]::IsNullOrWhiteSpace($version3)) {
                $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker responded after starting Docker Desktop service / app.' -Details @{
                    serverVersion = [string]$version3
                    dockerExe     = [string]$dockerExe
                    wslHeal       = $wslHeal
                    dockerEngine  = $dockEng
                } -Warnings @('We started com.docker.service and relaunched Docker Desktop; if this happens often, use Troubleshooting - Docker engine (Windows service).')
                Write-Output (Write-ScriptJson $payload)
                exit 0
            }
        }
        catch { }

        $failMsg = 'Docker is installed but the engine is not responding after WSL refresh and Windows service start.'
        if ($wslHeal.ok -and ($wslHeal.tail -match 'already')) {
            $failMsg = 'WSL looks current, but the Docker engine still will not answer. Try Troubleshooting - Docker engine (Windows service). If com.docker.service stays stopped, reinstall Docker Desktop or restart Windows once.'
        }
        if (-not $dockEng.serviceFound) {
            $failMsg = 'Docker CLI is present but com.docker.service was not found (incomplete install?). Reinstall Docker Desktop from Settings - Apps or docker.com.'
        }

        $payload = New-ScriptResult -Ok $false -Status error -Message $failMsg -Details @{
            wslHeal      = $wslHeal
            dockerEngine = $dockEng
        } -Errors @(
            [pscustomobject]@{ code = 'DOCKER_NOT_RUNNING'; message = [string]$firstErr }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker check failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'DOCKER_CHECK_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
