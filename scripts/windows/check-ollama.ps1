. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $ports = Get-PortsConfig
    $port = [int]$ports.ollama
    $exe = Get-OllamaExecutablePath

    function Get-TagsPayload {
        param([int]$ListenPort)
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$ListenPort/api/tags" -UseBasicParsing -TimeoutSec 5
        $tags = $resp.Content | ConvertFrom-Json
        $modelNames = @()
        if ($null -ne $tags.models) {
            $modelNames = @($tags.models | ForEach-Object { $_.name })
        }
        return $modelNames
    }

    try {
        $models = Get-TagsPayload -ListenPort $port
        $warnings = @()
        if ($null -eq $exe) {
            $warnings += 'Ollama API is up, but ollama.exe was not found on PATH or in standard folders. Model pulls from this session may fail until PATH is fixed.'
        }

        $payload = New-ScriptResult -Ok $true -Status success -Message 'Ollama is reachable.' -Details @{
            port      = $port
            url       = "http://localhost:$port"
            models    = $models
            ollamaExe = $exe
        } -Warnings $warnings
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }
    catch {
        if ($null -ne $exe) {
            $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama is installed but the API is not responding.' -Details @{
                port      = $port
                ollamaExe = $exe
            } -Errors @([pscustomobject]@{ code = 'OLLAMA_API_DOWN'; message = $_.Exception.Message })
            Write-Output (Write-ScriptJson $payload)
            exit 1
        }

        $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama does not appear to be installed or running.' -Details @{
            port           = $port
            searchedPaths  = @(
                (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
                (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
            )
        } -Errors @([pscustomobject]@{ code = 'OLLAMA_NOT_FOUND'; message = 'No ollama.exe and nothing listening on the Ollama port.' })
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
