param(
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 18 -Detail 'Checking Ollama API'

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

    function Write-OllamaSuccess {
        param([string[]]$Models, [bool]$AutoStarted)
        $warnings = @()
        if ($null -eq $exe) {
            $warnings += 'Ollama API is up, but ollama.exe was not found on PATH or in standard folders. Model pulls from this session may fail until PATH is fixed.'
        }
        if ($AutoStarted) {
            $warnings += 'Ollama was not running; PrivateAI started it in the background for you.'
        }

        $ov = $(if ($null -eq $exe) { $null } else { Get-PrivateAIOllamaVersionLine $exe })
        $payload = New-ScriptResult -Ok $true -Status success -Message 'Ollama is reachable.' -Details @{
            port          = $port
            url           = "http://localhost:$port"
            models        = $Models
            ollamaExe     = $exe
            autoStarted   = [bool]$AutoStarted
            ollamaVersion = $ov
        } -Warnings $warnings
        Write-Output (Write-ScriptJson $payload)
    }

    try {
        $models = Get-TagsPayload -ListenPort $port
        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 100 -Detail 'Ollama answered'
        Write-OllamaSuccess -Models $models -AutoStarted $false
        exit 0
    }
    catch {
        if ($null -eq $exe) {
            $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama does not appear to be installed or running.' -Details @{
                port          = $port
                searchedPaths = @(
                    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
                    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
                )
            } -Errors @([pscustomobject]@{ code = 'OLLAMA_NOT_FOUND'; message = 'No ollama.exe and nothing listening on the Ollama port.' })
            Write-Output (Write-ScriptJson $payload)
            exit 1
        }

        Start-PrivateAIOllamaIfInstalled

        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase starting -Pct 32 -Detail 'Wake Ollama, waiting for API'

        $models2 = $null
        $deadline = (Get-Date).AddSeconds(90)
        $wakeStarted = Get-Date
        while ((Get-Date) -lt $deadline) {
            $elapsed = ((Get-Date) - $wakeStarted).TotalSeconds
            $pct = [int][Math]::Min(94, [Math]::Floor((32 + ($elapsed / [double]90) * 64)))
            Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase starting -Pct $pct -Detail 'Waiting for Ollama HTTP'
            Start-Sleep -Seconds 2
            try {
                $models2 = Get-TagsPayload -ListenPort $port
                break
            }
            catch { }
        }

        if ($null -ne $models2) {
            Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 100 -Detail 'Ollama answered'
            Write-OllamaSuccess -Models $models2 -AutoStarted $true
            exit 0
        }

        $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama is installed but did not become ready in time. Try starting Ollama from the Start menu, or restart your PC if this keeps happening.' -Details @{
            port        = $port
            ollamaExe   = $exe
            autoStarted = $true
        } -Errors @([pscustomobject]@{ code = 'OLLAMA_API_DOWN'; message = 'Listening port did not respond after auto-start retries.' })
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
