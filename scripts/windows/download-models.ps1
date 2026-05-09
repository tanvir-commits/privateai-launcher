param(
    [string]$Model = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    if ([string]::IsNullOrWhiteSpace($Model)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'No model specified.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'MODEL_MISSING'; message = 'Pass -Model <ollama model name>.' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama is not installed.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'OLLAMA_NOT_FOUND'; message = 'ollama.exe not found' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    & ollama pull $Model | Out-Null

    $payload = New-ScriptResult -Ok $true -Status success -Message "Model pull requested/finished for $Model." -Details @{
        model = $Model
    }
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Model download failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'MODEL_PULL_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
