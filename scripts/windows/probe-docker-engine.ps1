param(
    [string]$ProgressFile = ''
)

<#
 Fast, non-admin probe: if docker.exe resolves and the Linux engine answers,
 the Install Wizard can skip the elevated install-docker.ps1 step (avoid UAC churn).
 Returns JSON consumed by launcher only.
#>
. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 10 -Detail 'Locate docker CLI'

    $exe = Get-DockerExecutablePath
    if ([string]::IsNullOrWhiteSpace($exe)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker is not reachable from this launcher session (docker.exe missing).' -Details @{
            probeReason = 'no_docker_exe'
        } -Errors @(
            [pscustomobject]@{ code = 'DOCKER_ENGINE_PROBE_NO_EXE'; message = 'docker.exe not found under standard Desktop paths/PATH.' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 42 -Detail 'Docker engine handshake'

    $ver = $null
    $deadline = (Get-Date).AddSeconds(45)
    while ($null -eq $ver -and (Get-Date) -lt $deadline) {
        $ver = Get-PrivateAIDockerServerVersion -DockerExePath $exe
        if (-not [string]::IsNullOrWhiteSpace($ver)) { break }
        Start-Sleep -Seconds 3
    }

    if ([string]::IsNullOrWhiteSpace($ver)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker CLI is installed but the engine did not report a version quickly enough for probe skip.' -Details @{
            probeReason = 'engine_not_ready'; dockerExe = [string]$exe
        } -Errors @(
            [pscustomobject]@{ code = 'DOCKER_ENGINE_PROBE_TIMEOUT'; message = 'Server.Version empty/unstable during probe.' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 100 -Detail 'Engine OK'

    $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker engine is reachable — install step can be skipped (probe).' -Details @{
        dockerExe            = [string]$exe
        serverVersion        = [string]$ver
        wizardProbeSkippedInstall = $true
    }
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker engine probe failed.' -Details @{ exception = $_.Exception.Message } -Errors @(
        [pscustomobject]@{ code = 'DOCKER_ENGINE_PROBE_EXCEPTION'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
