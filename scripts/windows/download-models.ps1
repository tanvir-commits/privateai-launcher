param(
    # Default matches config/model-profiles.json starter text chat profile for CLI / manual runs.
    [string]$Model = 'qwen2.5:7b',
    [string]$ProgressFile = ''
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

    $exe = Get-OllamaExecutablePath
    if ([string]::IsNullOrWhiteSpace($exe)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama is not installed.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'OLLAMA_NOT_FOUND'; message = 'ollama.exe not found' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $pull = Invoke-PrivateAIOllamaPullWithProgress -OllamaExePath $exe -Model $Model `
        -ProgressFile $ProgressFile -OutputCharLimit 12000

    if ([int]$pull.ExitCode -ne 0) {
        $tail = [string]$pull.Output
        if ($tail.Length -gt 2400) {
            $tail = $tail.Substring([Math]::Max(0, $tail.Length - 2400))
        }
        $firstLine = ($tail -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1)
        if ([string]::IsNullOrWhiteSpace($firstLine)) { $firstLine = "exit code $($pull.ExitCode)" }
        $msg = "Could not pull Ollama model `"$Model`". $($firstLine.Trim())"
        $payload = New-ScriptResult -Ok $false -Status error -Message $msg -Details @{
            model          = $Model
            exitCode       = [int]$pull.ExitCode
            ollamaOutputTail = $tail
        } -Errors @(
            [pscustomobject]@{ code = 'MODEL_PULL_FAILED'; message = $tail }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $payload = New-ScriptResult -Ok $true -Status success -Message "Model pull finished for $Model." -Details @{
        model = $Model
    }
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Model download script failed unexpectedly.' -Details @{
        exception = [string]$_.Exception.Message
    } -Errors @(
        [pscustomobject]@{ code = 'MODEL_PULL_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
