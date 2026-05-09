param(
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase configure -Pct 45 -Detail 'workflow paths'

    $root = Get-PrivateAiRepoRoot
    $wf = Join-Path $root 'workflows\comfyui'

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase configure -Pct 100 -Detail 'Recorded'

    $payload = New-ScriptResult -Ok $true -Status success -Message 'Shipped API workflows live under workflows/comfyui (v0.1 ships templates only).' -Details @{
        workflowsDir = $wf
    }
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'ComfyUI configuration helper failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'COMFYUI_CONFIGURE_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
