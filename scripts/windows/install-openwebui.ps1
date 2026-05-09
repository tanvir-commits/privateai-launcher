. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Limit-Detail([string]$Text, [int]$Max = 6000) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max) + '…'
}

try {
    $dockerExe = Get-DockerExecutablePath
    if ([string]::IsNullOrWhiteSpace($dockerExe)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker is required before Open WebUI can run.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'DOCKER_NOT_INSTALLED'; message = 'docker.exe not found' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $ports = Get-PortsConfig
    $hostPort = [int]$ports.openWebui
    $ollamaPort = [int]$ports.ollama

    $image = 'ghcr.io/open-webui/open-webui:main'
    $name = 'privateai-open-webui'

    $inspect = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('inspect', $name) -OutputCharLimit 8000
    $exists = ($inspect.ExitCode -eq 0)

    if (-not $exists) {
        $pull = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('pull', $image) -OutputCharLimit 8000
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

    $payload = New-ScriptResult -Ok $true -Status success -Message 'Open WebUI container is present and started.' -Details @{
        container = $name
        url       = "http://localhost:$hostPort"
        ollamaUrl = "http://host.docker.internal:$ollamaPort"
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
