. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
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

    $dockerExe = Get-DockerExecutablePath
    if ($null -ne $dockerExe) {
        try {
            $version = & $dockerExe version --format '{{.Server.Version}}' 2>$null
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
            Start-Process -FilePath $desktopExe | Out-Null
            $payload = New-ScriptResult -Ok $true -Status warning -Message 'Docker Desktop is installed; launched it, but the engine is not ready yet.' -Details @{
                dockerExe = [string]$dockerExe
            } -Warnings @('Wait for Docker Desktop to finish startup, then continue.')
            Write-Output (Write-ScriptJson $payload)
            exit 0
        }
    }

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

    # winget returns before the MSI/bootstrapper finishes; elevated PATH lags until registry refresh (Get-DockerExecutablePath).
    $deadline = (Get-Date).AddSeconds(420)
    $dockerExe = $null
    $launchedDesktop = $false
    while ($null -eq $dockerExe -and (Get-Date) -lt $deadline) {
        $dockerExe = Get-DockerExecutablePath
        if ($null -ne $dockerExe) { break }

        $desktopExe = Get-DockerDesktopExePath
        if (-not $launchedDesktop -and $null -ne $desktopExe -and (Test-Path -LiteralPath $desktopExe)) {
            try {
                Start-Process -FilePath $desktopExe -ErrorAction Stop | Out-Null
                $launchedDesktop = $true
            }
            catch { }
        }
        Start-Sleep -Seconds 3
    }

    $desktopFinal = Get-DockerDesktopExePath

    if ($null -eq $dockerExe) {
        if ($null -ne $desktopFinal -and (Test-Path -LiteralPath $desktopFinal)) {
            try {
                if (-not $launchedDesktop) {
                    Start-Process -FilePath $desktopFinal | Out-Null
                }
            }
            catch { }

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
