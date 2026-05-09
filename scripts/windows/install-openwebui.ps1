. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($null -eq $docker) {
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

    docker.exe inspect $name *> $null 2>&1
    $exists = $LASTEXITCODE -eq 0

    if (-not $exists) {
        docker.exe pull $image | Out-Null
        docker.exe run -d --name $name --restart unless-stopped `
            -p "$($hostPort):8080" `
            -e OLLAMA_BASE_URL="http://host.docker.internal:$ollamaPort" `
            --add-host=host.docker.internal:host-gateway `
            -v "open-webui:/app/backend/data" `
            $image | Out-Null
    }
    else {
        docker.exe start $name | Out-Null
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
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI setup failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'OPENWEBUI_SETUP_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
