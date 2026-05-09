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

        $failMsg = 'Docker is installed but the engine is not responding after WSL refresh.'
        if ($wslHeal.ok -and ($wslHeal.tail -match 'already')) {
            $failMsg = 'WSL reports it is already current, but Docker still will not start the engine. Fully quit Docker from the system tray, restart Windows once, then run this check again (or open Docker Desktop after reboot).'
        }

        $payload = New-ScriptResult -Ok $false -Status error -Message $failMsg -Details @{
            wslHeal = $wslHeal
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
