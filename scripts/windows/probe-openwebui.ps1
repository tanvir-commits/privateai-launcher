param(
    [string]$ProgressFile = ''
)

<#
 Lightweight probe before install-openwebui.ps1: if the privateai-open-webui
 container exists AND is running, skip docker pull/run.
 Does not start/repair unhealthy containers — full installer handles that.
#>
. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Limit-Detail([string]$Text, [int]$Max = 6000) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max) + '…'
}

try {
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase preflight -Pct 12 -Detail 'Locate Docker'

    $dockerExe = Get-DockerExecutablePath
    if ([string]::IsNullOrWhiteSpace($dockerExe)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker is required before probing Open WebUI.' -Details @{
            probeReason = 'no_docker_exe'
        } -Errors @(
            [pscustomobject]@{ code = 'PROBE_OPENWEBUI_NO_DOCKER'; message = 'docker.exe missing' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $ports = Get-PortsConfig
    $hostPort = [int]$ports.openWebui
    $ollamaPort = [int]$ports.ollama
    $image = 'ghcr.io/open-webui/open-webui:v0.6.30'
    $name = 'privateai-open-webui'

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 40 -Detail 'Inspect container'

    $inspect = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('inspect', $name) -OutputCharLimit 8000
    if ($inspect.ExitCode -ne 0) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI container does not exist yet — full install script is needed.' -Details @{
            probeReason = 'no_container'; dockerOutputTail = $(Limit-Detail $inspect.Output 2400)
        } -Errors @(
            [pscustomobject]@{ code = 'PROBE_OPENWEBUI_NO_CONTAINER'; message = [string]$inspect.Output }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 70 -Detail 'Check running'

    $running = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('inspect', '-f', '{{.State.Running}}', $name) -OutputCharLimit 8000
    $isRunning = ($running.ExitCode -eq 0) -and ($running.Output -match '^\s*true\s*$')
    if (-not $isRunning) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI container exists but is not running — full install script should start/repair it.' -Details @{
            probeReason       = 'not_running'
            runningInspect    = $(Limit-Detail $running.Output 1200)
        } -Errors @(
            [pscustomobject]@{ code = 'PROBE_OPENWEBUI_NOT_RUNNING'; message = $running.Output }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 100 -Detail ('http://localhost:' + $hostPort)

    $payload = New-ScriptResult -Ok $true -Status success -Message 'Open WebUI is installed and running (probe) — installer step skipped.' -Details @{
        container               = $name
        containerImage          = [string]$image
        url                     = "http://localhost:$hostPort"
        ollamaUrl               = "http://host.docker.internal:$ollamaPort"
        wizardProbeSkippedInstall   = $true
    }
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI probe failed.' -Details @{
        exception = $(Limit-Detail $_.Exception.Message 1800)
    } -Errors @(
        [pscustomobject]@{ code = 'PROBE_OPENWEBUI_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
