param(
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    # When Docker CLI + Linux engine already answer, skip slow steps (ACL takeown/icacls, DISM,
    # wsl --update) — those can take many minutes while the UI shows "Installing" even though Docker is fine.
    $dockerExeFast = Get-DockerExecutablePath
    if (-not [string]::IsNullOrWhiteSpace($dockerExeFast)) {
        $verFast = $null
        for ($attempt = 0; $attempt -lt 8; $attempt++) {
            $verFast = Get-PrivateAIDockerServerVersion -DockerExePath $dockerExeFast
            if (-not [string]::IsNullOrWhiteSpace($verFast)) { break }
            Start-Sleep -Seconds 2
        }
        if (-not [string]::IsNullOrWhiteSpace($verFast)) {
            $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker is already installed and running.' -Details @{
                dockerExe       = [string]$dockerExeFast
                serverVersion = [string]$verFast
                skippedHeavyPrereqs = $true
            }
            Write-Output (Write-ScriptJson $payload)
            exit 0
        }
    }

    # Run first while elevated: wrong ownership here blocks Docker (blue banner in admin console).
    $aclFix = Repair-DockerProgramDataFolder
    if (-not $aclFix.ok) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Could not repair ownership on ProgramData\DockerDesktop. Use Troubleshooting - Docker ProgramData ACL (admin), or remove that folder after uninstall, then retry.' -Details @{
            aclRepair = $aclFix
        } -Errors @(
            [pscustomobject]@{
                code    = 'DOCKER_PROGRAMDATA_ACL_FAILED'
                message = $(if ($aclFix.detail) { [string]$aclFix.detail } else { 'takeown or icacls returned non-zero; see details.aclRepair' })
            }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase preflight -Pct 12 -Detail 'ProgramData ACL OK'

    $winVirt = Enable-PrivateAIDockerWindowsOptionalFeatures
    if (-not $winVirt.ok) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Could not enable Windows Subsystem for Linux and/or Virtual Machine Platform (DISM). See details; you may need an admin session or a supported Windows edition.' -Details @{
            prerequisiteLog = @($winVirt.logLines)
            failedFeature     = $winVirt.failedFeature
            lastExitCode      = $winVirt.lastExitCode
        } -Errors @(
            [pscustomobject]@{ code = 'DOCKER_WINDOWS_PREREQ_DISM_FAILED'; message = 'DISM enable-feature failed' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase preflight -Pct 26 -Detail 'Hyper-V/WSL prerequisites ready'

    if ($winVirt.rebootNeeded) {
        $payload = New-ScriptResult -Ok $true -Status warning -Message 'WSL and Virtual Machine Platform are enabled. Restart the PC once, then click Run install flow again so Docker can finish installing and starting.' -Details @{
            prerequisiteLog = @($winVirt.logLines)
            rebootRequired    = $true
        } -Warnings @('Windows requires a restart (DISM 3010) before Docker can use virtualization. This is expected.')
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }

    $wslUp = Update-PrivateAIWslInPlace
    if (-not $wslUp.ok) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker needs an up-to-date WSL kernel but wsl --update failed. Use Troubleshooting - WSL update (admin), or run wsl --update in an elevated terminal, then retry this step.' -Details @{
            wslUpdate = $wslUp
        } -Errors @(
            [pscustomobject]@{ code = 'WSL_UPDATE_FAILED'; message = [string]$wslUp.tail }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase wsl -Pct 38 -Detail 'WSL kernel updated'

    $dockerExe = Get-DockerExecutablePath
    if ($null -ne $dockerExe) {
        try {
            $version = $null
            for ($attempt2 = 0; $attempt2 -lt 5; $attempt2++) {
                $version = Get-PrivateAIDockerServerVersion -DockerExePath $dockerExe
                if (-not [string]::IsNullOrWhiteSpace($version)) { break }
                Start-Sleep -Seconds 2
            }
            if (-not [string]::IsNullOrWhiteSpace($version)) {
                $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker is already installed and running.' -Details @{
                    dockerExe       = [string]$dockerExe
                    serverVersion = [string]$version
                }
                Write-Output (Write-ScriptJson $payload)
                exit 0
            }
        }
        catch { }

        $desktopExe = Get-DockerDesktopExePath
        if ($null -ne $desktopExe -and (Test-Path -LiteralPath $desktopExe)) {
            $dockEng = Start-PrivateAIDockerWindowsEngine
            $payload = New-ScriptResult -Ok $true -Status warning -Message 'Docker Desktop is installed; launched it, but the engine is not ready yet.' -Details @{
                dockerExe     = [string]$dockerExe
                dockerEngine  = $dockEng
            } -Warnings @('Wait for Docker Desktop to finish startup, then continue.')
            Write-Output (Write-ScriptJson $payload)
            exit 0
        }
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase winget -Pct 44 -Detail 'Docker Desktop via winget (may take several minutes)'

    # --silent: suppress winget UI; Docker may still show WSL/backend prompts outside winget on first engine start.
    $out = & winget install -e --id Docker.DockerDesktop --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1
    $wingetExit = $LASTEXITCODE
    $text = ($out | Out-String)

    $wingetList = ''
    try {
        $wl = & winget list -e --id Docker.DockerDesktop 2>&1 | Out-String
        if (-not [string]::IsNullOrWhiteSpace($wl)) { $wingetList = $wl }
    }
    catch { }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase install -Pct 52 -Detail 'Waiting for Docker Desktop files and PATH'

    # winget returns before the MSI/bootstrapper finishes; elevated PATH lags until registry refresh (Get-DockerExecutablePath).
    $deadline = (Get-Date).AddSeconds(420)
    $heavyStart = Get-Date
    $dockerExe = $null
    $launchedDesktop = $false
    $enginePrimedBeforeDesktopPoll = $false
    while ($null -eq $dockerExe -and (Get-Date) -lt $deadline) {
        $dockerExe = Get-DockerExecutablePath
        if ($null -ne $dockerExe) { break }

        $desktopExe = Get-DockerDesktopExePath
        if (-not $launchedDesktop -and $null -ne $desktopExe -and (Test-Path -LiteralPath $desktopExe)) {
            try {
                if (-not $enginePrimedBeforeDesktopPoll) {
                    $null = Start-PrivateAIDockerWindowsEngine -SkipLaunchDesktop
                    $enginePrimedBeforeDesktopPoll = $true
                }
                Set-PrivateAIDockerDesktopQuietUiHints
                Start-Process -FilePath $desktopExe -WindowStyle Minimized -ErrorAction Stop | Out-Null
                $launchedDesktop = $true
            }
            catch { }
        }
        try {
            $el = ((Get-Date) - $heavyStart).TotalSeconds
            $span = [double]420
            $bridge = [int][Math]::Min(40, [Math]::Floor(($el / $span) * 40))
            $pct = [int][Math]::Min(93, 52 + $bridge)
            Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase install -Pct $pct -Detail 'Finishing install; follow any Docker Desktop prompts'
        }
        catch { }
        Start-Sleep -Seconds 3
    }

    $desktopFinal = Get-DockerDesktopExePath

    if ($null -eq $dockerExe) {
        if ($null -ne $desktopFinal -and (Test-Path -LiteralPath $desktopFinal)) {
            try {
                if (-not $launchedDesktop) {
                    $null = Start-PrivateAIDockerWindowsEngine -SkipLaunchDesktop
                    Set-PrivateAIDockerDesktopQuietUiHints
                    Start-Process -FilePath $desktopFinal -WindowStyle Minimized | Out-Null
                }
            }
            catch { }

            Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase install -Pct 96 -Detail 'Docker Desktop launching; wait for tray icon'

            $payload = New-ScriptResult -Ok $true -Status warning -Message 'Docker Desktop appears installed but docker.exe was not found yet (installer may still be finishing). Use Check Docker Desktop after Docker finishes first-time setup, or sign out and back in.' -Details @{
                wingetExitCode    = $wingetExit
                dockerDesktopExe  = [string]$desktopFinal
                wingetOutputTail  = $text.Substring([Math]::Max(0, $text.Length - 3000))
                wingetListDocker  = $wingetList.Substring([Math]::Max(0, $wingetList.Length - 2000))
            } -Warnings @(
                'Wait until Docker Desktop completes setup (system tray icon steady), then run Check Docker Desktop.',
                'If the CLI is still missing after a reboot, repair Docker Desktop from Settings - Apps (installed apps).'
            )
            Write-Output (Write-ScriptJson $payload)
            exit 0
        }

        $dockerFolderProbe = ''
        $pfDocker = Join-Path $env:ProgramFiles 'Docker'
        if (Test-Path -LiteralPath $pfDocker) {
            try {
                $dockerFolderProbe = (Get-ChildItem -LiteralPath $pfDocker -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', '
            }
            catch { }
        }

        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker install finished but docker.exe was not detected and Docker Desktop was not found under Program Files or your profile. Check the Log details for winget output.' -Details @{
            wingetExitCode      = $wingetExit
            wingetOutputTail    = $text.Substring([Math]::Max(0, $text.Length - 3000))
            wingetListDocker    = $wingetList.Substring([Math]::Max(0, $wingetList.Length - 2000))
            programFilesDocker  = $dockerFolderProbe
            hint                = 'If winget failed, install Docker Desktop manually from docker.com/products/docker-desktop, then re-run this wizard.'
        } -Errors @(
            [pscustomobject]@{ code = 'DOCKER_INSTALL_VERIFY_FAILED'; message = 'docker.exe and Docker Desktop.exe not found after installation attempt.' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase install -Pct 100 -Detail 'docker.exe detected'

    $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker Desktop install completed.' -Details @{
        dockerExe        = [string]$dockerExe
        wingetExitCode   = $wingetExit
        wingetOutputTail = $text.Substring([Math]::Max(0, $text.Length - 2000))
    }
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker install failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'DOCKER_INSTALL_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
