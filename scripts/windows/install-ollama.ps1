. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $exe = Get-OllamaExecutablePath
    if ($null -ne $exe) {
        $payload = New-ScriptResult -Ok $true -Status success -Message 'Ollama is already installed.' -Details @{
            path = [string]$exe
        }
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }

    $payload = New-ScriptResult -Ok $false -Status warning -Message 'Ollama is not installed. Install from https://ollama.com/download/windows' -Details @{
        downloadUrl = 'https://ollama.com/download/windows'
    } -Errors @(
        [pscustomobject]@{ code = 'OLLAMA_INSTALL_REQUIRED'; message = 'User action required: install Ollama for Windows.' }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama install check failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'OLLAMA_INSTALL_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
