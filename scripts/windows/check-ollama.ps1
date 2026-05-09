. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $ports = Get-PortsConfig
    $port = [int]$ports.ollama
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue

    if ($null -eq $cmd) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama is not installed (ollama.exe not found on PATH).' -Details @{
            port = $port
        } -Errors @([pscustomobject]@{ code = 'OLLAMA_NOT_FOUND'; message = 'ollama command not found' })
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/tags" -UseBasicParsing -TimeoutSec 5
        $tags = $resp.Content | ConvertFrom-Json
        $modelNames = @()
        if ($null -ne $tags.models) {
            $modelNames = @($tags.models | ForEach-Object { $_.name })
        }

        $payload = New-ScriptResult -Ok $true -Status success -Message 'Ollama is reachable.' -Details @{
            port    = $port
            url     = "http://localhost:$port"
            models  = $modelNames
        }
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }
    catch {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama is installed but the API is not responding.' -Details @{
            port = $port
        } -Errors @([pscustomobject]@{ code = 'OLLAMA_API_DOWN'; message = $_.Exception.Message })
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama check failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'OLLAMA_CHECK_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
