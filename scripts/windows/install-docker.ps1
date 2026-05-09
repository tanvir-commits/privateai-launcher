. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $dockerExe = Get-DockerExecutablePath
    if ($null -ne $dockerExe) {
        try {
            $version = & $dockerExe version --format '{{.Server.Version}}' 2>$null
            if (-not [string]::IsNullOrWhiteSpace($version)) {
                $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker is already installed and running.' -Details @{
                    dockerExe     = [string]$dockerExe
                    serverVersion = [string]$version
                }
                Write-Output (Write-ScriptJson $payload)
                exit 0
            }
        }
        catch { }

        $desktopPath = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (Test-Path -LiteralPath $desktopPath) {
            Start-Process -FilePath $desktopPath | Out-Null
            $payload = New-ScriptResult -Ok $true -Status warning -Message 'Docker Desktop is installed; launched it, but the engine is not ready yet.' -Details @{
                dockerExe = [string]$dockerExe
            } -Warnings @('Wait for Docker Desktop to finish startup, then continue.')
            Write-Output (Write-ScriptJson $payload)
            exit 0
        }
    }

    $out = & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1
    $text = ($out | Out-String)
    $dockerExe = Get-DockerExecutablePath
    if ($null -eq $dockerExe) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker install command finished but docker.exe was not detected.' -Details @{
            wingetOutputTail = $text.Substring([Math]::Max(0, $text.Length - 3000))
        } -Errors @(
            [pscustomobject]@{ code = 'DOCKER_INSTALL_VERIFY_FAILED'; message = 'docker.exe not found after installation attempt.' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker Desktop install completed.' -Details @{
        dockerExe      = [string]$dockerExe
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
