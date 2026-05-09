. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($null -eq $docker) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker is not installed or not on PATH.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'DOCKER_NOT_FOUND'; message = 'docker.exe not found' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    try {
        $version = & docker.exe version --format '{{.Server.Version}}' 2>$null
        if ([string]::IsNullOrWhiteSpace($version)) {
            throw 'Docker server version unavailable (is Docker Desktop running?)'
        }

        $payload = New-ScriptResult -Ok $true -Status success -Message 'Docker is installed and responding.' -Details @{
            serverVersion = [string]$version
        }
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }
    catch {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Docker is installed but the engine is not responding.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'DOCKER_NOT_RUNNING'; message = $_.Exception.Message }
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
