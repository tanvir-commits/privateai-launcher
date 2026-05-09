param(
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase configure -Pct 40 -Detail 'Compose hints'

    $ports = Get-PortsConfig
    $ollamaPort = [int]$ports.ollama
    $owPort = [int]$ports.openWebui

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase configure -Pct 100 -Detail 'Done'

    $payload = New-ScriptResult -Ok $true -Status success -Message 'Open WebUI should use host.docker.internal for Ollama when running in Docker.' -Details @{
        suggestedOllamaUrl = "http://host.docker.internal:$ollamaPort"
        openWebUiUrl       = "http://localhost:$owPort"
        note               = 'If image gen is enabled later, point image backend to ComfyUI on localhost from the Open WebUI admin UI.'
    }
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Open WebUI configuration helper failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'OPENWEBUI_CONFIGURE_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
