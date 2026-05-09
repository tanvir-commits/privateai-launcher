param(
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Limit-Detail([string]$Text, [int]$Max = 6000) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max) + '…'
}

try {
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase preflight -Pct 10 -Detail 'Locate Docker'

    $dockerExe = Get-DockerExecutablePath
    if ([string]::IsNullOrWhiteSpace($dockerExe)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker is required before Open WebUI can run.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'DOCKER_NOT_INSTALLED'; message = 'docker.exe not found' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 26 -Detail 'Inspect Open WebUI container'

    $ports = Get-PortsConfig
    $hostPort = [int]$ports.openWebui
    $ollamaPort = [int]$ports.ollama

    # Pinned (not :main): current :main digest fails on some Docker Desktop/WSL2 setups with
    # `exec /usr/bin/bash: exec format error` while release tags run correctly.
    $image = 'ghcr.io/open-webui/open-webui:v0.6.30'
    $name = 'privateai-open-webui'

    $inspect = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('inspect', $name) -OutputCharLimit 8000
    $exists = ($inspect.ExitCode -eq 0)

    if (-not $exists) {
        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct 34 -Detail 'Pull Open WebUI image'

        $pull = Invoke-PrivateAIDockerPullWithProgress -DockerExePath $dockerExe -Image $image -ProgressFile $ProgressFile `
            -OutputCharLimit 16000

        if ($pull.ExitCode -ne 0) {
            $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI setup failed: could not pull container image.' -Details @{
                phase = 'pull'
                dockerOutput = $pull.Output
            } -Errors @(
                [pscustomobject]@{ code = 'OPENWEBUI_DOCKER_PULL_FAILED'; message = $pull.Output }
            )
            Write-Output (Write-ScriptJson $payload)
            exit 1
        }

        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase install -Pct 78 -Detail 'Creating container'

        $runArgs = @(
            'run', '-d', '--name', $name, '--restart', 'unless-stopped',
            '-p', "${hostPort}:8080",
            '-e', "OLLAMA_BASE_URL=http://host.docker.internal:${ollamaPort}",
            '--add-host', 'host.docker.internal:host-gateway',
            '-v', 'open-webui:/app/backend/data',
            $image
        )
        $run = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList $runArgs -OutputCharLimit 8000
        if ($run.ExitCode -ne 0) {
            $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI setup failed: docker run returned an error.' -Details @{
                phase = 'run'
                dockerOutput = $run.Output
            } -Errors @(
                [pscustomobject]@{ code = 'OPENWEBUI_DOCKER_RUN_FAILED'; message = $run.Output }
            )
            Write-Output (Write-ScriptJson $payload)
            exit 1
        }
    }
    else {
        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase starting -Pct 60 -Detail 'Existing container'

        $null = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('update', '--restart', 'unless-stopped', $name) -OutputCharLimit 4000

        $start = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('start', $name) -OutputCharLimit 8000
        if ($start.ExitCode -ne 0) {
            $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI setup failed: could not start existing container.' -Details @{
                phase = 'start'
                dockerOutput = $start.Output
            } -Errors @(
                [pscustomobject]@{ code = 'OPENWEBUI_DOCKER_START_FAILED'; message = $start.Output }
            )
            Write-Output (Write-ScriptJson $payload)
            exit 1
        }
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 88 -Detail 'Verify running'

    $running = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('inspect', '-f', '{{.State.Running}}', $name) -OutputCharLimit 8000
    $isRunning = ($running.ExitCode -eq 0) -and ($running.Output -match '^\s*true\s*$')
    if (-not $isRunning) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI setup failed: container is not running.' -Details @{
            phase = 'verify'
            runningInspect = $running.Output
        } -Errors @(
            [pscustomobject]@{ code = 'OPENWEBUI_NOT_RUNNING'; message = $running.Output }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase check -Pct 100 -Detail "http://localhost:$hostPort"

    $payload = New-ScriptResult -Ok $true -Status success -Message 'Open WebUI container is present and started.' -Details @{
        container      = $name
        containerImage = [string]$image
        url            = "http://localhost:$hostPort"
        ollamaUrl      = "http://host.docker.internal:$ollamaPort"
    }
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI setup failed.' -Details @{
        exception = (Limit-Detail $_.Exception.Message 2000)
    } -Errors @(
        [pscustomobject]@{ code = 'OPENWEBUI_SETUP_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
