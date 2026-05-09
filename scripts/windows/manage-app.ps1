param(
    [Parameter(Mandatory)][ValidateSet('Ollama', 'OpenWebUi', 'DockerDesktop')][string]$App,
    [Parameter(Mandatory)][ValidateSet('Restart', 'Update', 'Uninstall', 'Reinstall')][string]$Action,
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Limit-Detail([string]$Text, [int]$Max = 4000) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max) + '…'
}

function Invoke-WingetExitCode {
    param([Parameter(Mandatory)][string[]]$ArgumentList)
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($null -eq $winget) {
        return @{ ok = $false; exit = -1; output = 'winget.exe not found on PATH' }
    }
    $tid = [Guid]::NewGuid().ToString('n')
    $outPath = Join-Path $env:TEMP "privateai-winget-$tid.out.txt"
    $errPath = Join-Path $env:TEMP "privateai-winget-$tid.err.txt"
    Remove-Item -LiteralPath $outPath, $errPath -Force -ErrorAction SilentlyContinue
    try {
        $p = Start-Process -FilePath 'winget.exe' -ArgumentList $ArgumentList -PassThru -NoNewWindow `
            -RedirectStandardOutput $outPath -RedirectStandardError $errPath -Wait
        $ec = 1
        if ($null -ne $p.ExitCode) { $ec = [int]$p.ExitCode }
        $o = if (Test-Path -LiteralPath $outPath) { [System.IO.File]::ReadAllText($outPath) } else { '' }
        $e = if (Test-Path -LiteralPath $errPath) { [System.IO.File]::ReadAllText($errPath) } else { '' }
        $merged = ($o + "`n" + $e).Trim()
        return @{ ok = ($ec -eq 0 -or $ec -eq -1978335189); exit = $ec; output = $merged }
    }
    finally {
        Remove-Item -LiteralPath $outPath, $errPath -Force -ErrorAction SilentlyContinue
    }
}

function Start-ChildInstallerPs1 {
    param([Parameter(Mandatory)][string]$ScriptFileName, [string]$ProgressFile)
    $path = Join-Path $PSScriptRoot $ScriptFileName
    if (-not (Test-Path -LiteralPath $path)) {
        return 1
    }
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $path)
    if (-not [string]::IsNullOrWhiteSpace($ProgressFile)) {
        $argList += @('-ProgressFile', $ProgressFile)
    }
    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -PassThru -NoNewWindow -Wait
    if ($null -eq $p) { return 1 }
    return [int]$p.ExitCode
}

function Ensure-OpenWebUiContainer {
    param(
        [Parameter(Mandatory)][string]$DockerExe,
        [Parameter(Mandatory)][int]$HostPort,
        [Parameter(Mandatory)][int]$OllamaPort,
        [Parameter(Mandatory)][string]$Image,
        [Parameter(Mandatory)][string]$Name
    )
    $runArgs = @(
        'run', '-d', '--name', $Name, '--restart', 'unless-stopped',
        '-p', "${HostPort}:8080",
        '-e', "OLLAMA_BASE_URL=http://host.docker.internal:${OllamaPort}",
        '--add-host', 'host.docker.internal:host-gateway',
        '-v', 'open-webui:/app/backend/data',
        $Image
    )
    return Invoke-PrivateAIDocker -DockerExePath $DockerExe -ArgList $runArgs -OutputCharLimit 12000
}

try {
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase configure -Pct 5 -Detail "$App $Action"

    switch ($App) {
        'Ollama' {
            switch ($Action) {
                'Restart' {
                    Start-PrivateAIOllamaIfInstalled | Out-Null
                    $payload = New-ScriptResult -Ok $true -Status success -Message 'Attempted to start Ollama (service or app).' -Details @{ app = 'Ollama'; action = 'Restart' }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
                'Update' {
                    $r = Invoke-WingetExitCode -ArgumentList @(
                        'upgrade', '-e', '--id', 'Ollama.Ollama', '--silent',
                        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
                    )
                    if (-not $r.ok) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'winget upgrade Ollama failed or reported no upgrade.' -Details @{
                            exitCode = $r.exit; outputTail = (Limit-Detail $r.output 3000)
                        } -Errors @(
                            [pscustomobject]@{ code = 'OLLAMA_WINGET_UPGRADE'; message = (Limit-Detail $r.output 1200) }
                        )
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $payload = New-ScriptResult -Ok $true -Status success -Message 'winget upgrade completed for Ollama.' -Details @{ exitCode = $r.exit; outputTail = (Limit-Detail $r.output 2000) }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
                'Uninstall' {
                    $r = Invoke-WingetExitCode -ArgumentList @(
                        'uninstall', '-e', '--id', 'Ollama.Ollama', '--silent',
                        '--accept-source-agreements', '--disable-interactivity'
                    )
                    if (-not $r.ok) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'winget uninstall Ollama failed.' -Details @{
                            exitCode = $r.exit; outputTail = (Limit-Detail $r.output 3000)
                        } -Errors @(
                            [pscustomobject]@{ code = 'OLLAMA_WINGET_UNINSTALL'; message = (Limit-Detail $r.output 1200) }
                        )
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $payload = New-ScriptResult -Ok $true -Status success -Message 'Ollama was removed via winget.' -Details @{ exitCode = $r.exit }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
                'Reinstall' {
                    $u = Invoke-WingetExitCode -ArgumentList @(
                        'uninstall', '-e', '--id', 'Ollama.Ollama', '--silent',
                        '--accept-source-agreements', '--disable-interactivity'
                    )
                    $null = $u
                    $ec = Start-ChildInstallerPs1 -ScriptFileName 'install-ollama.ps1' -ProgressFile $ProgressFile
                    if ($ec -ne 0) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'Reinstall: install-ollama.ps1 did not exit cleanly after uninstall attempt.' -Details @{ childExit = $ec }
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $payload = New-ScriptResult -Ok $true -Status success -Message 'Ollama reinstall finished (uninstall attempt + install script).' -Details @{}
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
            }
        }
        'OpenWebUi' {
            $dockerExe = Get-DockerExecutablePath
            if ([string]::IsNullOrWhiteSpace($dockerExe)) {
                $payload = New-ScriptResult -Ok $false -Status error -Message 'docker.exe not found. Install Docker Desktop first.' -Details @{} -Errors @(
                    [pscustomobject]@{ code = 'DOCKER_EXE_MISSING'; message = 'docker not on PATH' }
                )
                Write-Output (Write-ScriptJson $payload)
                exit 1
            }
            $ports = Get-PortsConfig
            $hostPort = [int]$ports.openWebui
            $ollamaPort = [int]$ports.ollama
            $image = 'ghcr.io/open-webui/open-webui:v0.6.30'
            $name = 'privateai-open-webui'

            switch ($Action) {
                'Restart' {
                    $targetName = $name
                    $exists = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('inspect', '-f', '{{.Id}}', $targetName) -OutputCharLimit 800
                    $resolvedAlt = $null
                    if ($exists.ExitCode -ne 0) {
                        $resolvedAlt = Resolve-PrivateAIOpenWebUiContainerName -DockerExePath $dockerExe -HostPort $hostPort
                        if (-not [string]::IsNullOrWhiteSpace($resolvedAlt)) {
                            $targetName = $resolvedAlt
                        }
                    }
                    $st = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('start', $targetName) -OutputCharLimit 4000
                    if ($st.ExitCode -eq 0) {
                        $payload = New-ScriptResult -Ok $true -Status success -Message 'Started Open WebUI container.' -Details @{ container = $targetName }
                        Write-Output (Write-ScriptJson $payload)
                        exit 0
                    }

                    $noContainer = ($exists.ExitCode -ne 0 -and [string]::IsNullOrWhiteSpace($resolvedAlt)) -or ($st.Output -match '(?i)no such container')
                    if ($noContainer) {
                        $ec = Start-ChildInstallerPs1 -ScriptFileName 'install-openwebui.ps1' -ProgressFile $ProgressFile
                        if ($ec -ne 0) {
                            $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI container is missing; install-openwebui.ps1 did not complete. Use Install Wizard or check Docker logs.' -Details @{ childExit = $ec } -Errors @(
                                [pscustomobject]@{ code = 'OPENWEBUI_INSTALL_FAILED'; message = 'install-openwebui.ps1 exit ' + $ec }
                            )
                            Write-Output (Write-ScriptJson $payload)
                            exit 1
                        }
                        $payload = New-ScriptResult -Ok $true -Status success -Message 'Open WebUI container was missing; install-openwebui.ps1 created and started it (existing data volume kept if present).' -Details @{ container = $name; viaInstaller = $true }
                        Write-Output (Write-ScriptJson $payload)
                        exit 0
                    }

                    $payload = New-ScriptResult -Ok $false -Status warning -Message 'docker start failed. If Docker Desktop shows HTTP 304, quit Docker Desktop completely and reopen, then retry.' -Details @{ container = $targetName; dockerOutput = (Limit-Detail $st.Output 2400) } -Errors @(
                        [pscustomobject]@{ code = 'OPENWEBUI_START_FAILED'; message = (Limit-Detail $st.Output 800) }
                    )
                    Write-Output (Write-ScriptJson $payload)
                    exit 1
                }
                'Update' {
                    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase download -Pct 20 -Detail 'docker pull Open WebUI'
                    $pull = Invoke-PrivateAIDockerPullWithProgress -DockerExePath $dockerExe -Image $image -ProgressFile $ProgressFile -OutputCharLimit 16000
                    if ($pull.ExitCode -ne 0) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'docker pull failed for Open WebUI image.' -Details @{ output = (Limit-Detail $pull.Output 3000) } -Errors @(
                            [pscustomobject]@{ code = 'OPENWEBUI_PULL_FAILED'; message = (Limit-Detail $pull.Output 1200) }
                        )
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $null = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('stop', $name) -OutputCharLimit 4000
                    $rm = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('rm', '-f', $name) -OutputCharLimit 4000
                    $run = Ensure-OpenWebUiContainer -DockerExe $dockerExe -HostPort $hostPort -OllamaPort $ollamaPort -Image $image -Name $name
                    if ($run.ExitCode -ne 0) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'Could not recreate Open WebUI container after pull.' -Details @{ dockerOutput = (Limit-Detail $run.Output 3000) } -Errors @(
                            [pscustomobject]@{ code = 'OPENWEBUI_RUN_FAILED'; message = (Limit-Detail $run.Output 1200) }
                        )
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $payload = New-ScriptResult -Ok $true -Status success -Message 'Open WebUI image updated and container recreated (data volume kept).' -Details @{ container = $name; url = "http://localhost:$hostPort" }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
                'Uninstall' {
                    $null = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('rm', '-f', $name) -OutputCharLimit 4000
                    $payload = New-ScriptResult -Ok $true -Status success -Message "Removed Open WebUI container (Docker volume open-web-ui was kept for your chats)." -Details @{ container = $name; dataVolumeKept = $true }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
                'Reinstall' {
                    $null = Invoke-PrivateAIDocker -DockerExePath $dockerExe -ArgList @('rm', '-f', $name) -OutputCharLimit 4000
                    $ec = Start-ChildInstallerPs1 -ScriptFileName 'install-openwebui.ps1' -ProgressFile $ProgressFile
                    if ($ec -ne 0) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'Reinstall: install-openwebui.ps1 failed after removing container.' -Details @{ childExit = $ec }
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $payload = New-ScriptResult -Ok $true -Status success -Message 'Open WebUI container recreated via install script.' -Details @{ container = $name }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
            }
        }
        'DockerDesktop' {
            switch ($Action) {
                'Restart' {
                    $eng = Start-PrivateAIDockerWindowsEngine
                    if (-not $eng.serviceRunning) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'Could not confirm Docker engine/service running.' -Details @{ dockerEngine = $eng } -Errors @(
                            [pscustomobject]@{ code = 'DOCKER_ENGINE_RESTART_FAILED'; message = [string]$eng.startError }
                        )
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $ow = Start-PrivateAIOpenWebUiContainerIfStopped
                    $msg = 'Docker Desktop engine/service start attempted.'
                    if ($ow.action -eq 'started') {
                        $msg = "$msg Also started the Open WebUI container."
                    }
                    $status = if ($ow.action -eq 'start_failed' -or $ow.action -eq 'error') { 'warning' } else { 'success' }
                    if ($ow.action -eq 'start_failed' -or $ow.action -eq 'error') {
                        $msg = "$msg Open WebUI container did not start automatically; use Open WebUI > Restart or Docker Desktop."
                    }
                    $payload = New-ScriptResult -Ok $true -Status $status -Message $msg -Details @{ dockerEngine = $eng; openWebUiContainer = $ow }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
                'Update' {
                    $r = Invoke-WingetExitCode -ArgumentList @(
                        'upgrade', '-e', '--id', 'Docker.DockerDesktop', '--silent',
                        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
                    )
                    if (-not $r.ok) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'winget upgrade Docker Desktop failed or reported no upgrade.' -Details @{
                            exitCode = $r.exit; outputTail = (Limit-Detail $r.output 3000)
                        } -Errors @(
                            [pscustomobject]@{ code = 'DOCKER_WINGET_UPGRADE'; message = (Limit-Detail $r.output 1200) }
                        )
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $payload = New-ScriptResult -Ok $true -Status success -Message 'winget upgrade completed for Docker Desktop.' -Details @{ exitCode = $r.exit; outputTail = (Limit-Detail $r.output 2000) }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
                'Uninstall' {
                    $r = Invoke-WingetExitCode -ArgumentList @(
                        'uninstall', '-e', '--id', 'Docker.DockerDesktop', '--silent',
                        '--accept-source-agreements', '--disable-interactivity'
                    )
                    if (-not $r.ok) {
                        $payload = New-ScriptResult -Ok $false -Status error -Message 'winget uninstall Docker Desktop failed.' -Details @{
                            exitCode = $r.exit; outputTail = (Limit-Detail $r.output 3000)
                        } -Errors @(
                            [pscustomobject]@{ code = 'DOCKER_WINGET_UNINSTALL'; message = (Limit-Detail $r.output 1200) }
                        )
                        Write-Output (Write-ScriptJson $payload)
                        exit 1
                    }
                    $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker Desktop was removed via winget. Reboot if Windows still shows Docker components.' -Details @{ exitCode = $r.exit }
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
                'Reinstall' {
                    $payload = New-ScriptResult -Ok $true -Status warning -Message "Docker reinstall is not run automatically from here. Use Install Wizard (Install/verify Docker Desktop, admin), or winget install Docker.DockerDesktop after uninstall." -Details @{
                        hint = 'Install Wizard /install'
                    } -Warnings @('Prefer the wizard so WSL and DISM prerequisites stay consistent.')
                    Write-Output (Write-ScriptJson $payload)
                    exit 0
                }
            }
        }
    }

    $payload = New-ScriptResult -Ok $false -Status error -Message 'Unhandled manage-app combination.' -Details @{ app = $App; action = $Action } -Errors @(
        [pscustomobject]@{ code = 'MANAGE_APP_UNHANDLED'; message = "$App $Action" }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'manage-app.ps1 failed.' -Details @{
        exception = (Limit-Detail $_.Exception.Message 2000)
    } -Errors @(
        [pscustomobject]@{ code = 'MANAGE_APP_EXCEPTION'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
