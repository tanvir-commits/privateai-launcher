. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $ports = Get-PortsConfig
    $port = [int]$ports.comfyui

    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 3
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
            $payload = New-ScriptResult -Ok $true -Status success -Message 'ComfyUI appears to be running.' -Details @{
                url = "http://localhost:$port"
            }
            Write-Output (Write-ScriptJson $payload)
            exit 0
        }
    }
    catch { }

    # ok=true + warnings: this step only probes localhost; ComfyUI is not installed by PrivateAI yet.
    # If we used ok=false here, the Install Wizard would show a hard Error chip and stop the run.
    $payload = New-ScriptResult -Ok $true -Status warning -Message 'ComfyUI is not detected on localhost. Install ComfyUI Desktop or portable, then enable --listen on port 8188.' -Details @{
        url        = "http://localhost:$port"
        comfyGuide = 'https://github.com/comfyanonymous/ComfyUI'
    } -Warnings @(
        'Optional for chat-only stacks. User action: install/start ComfyUI on port 8188, then re-run the wizard or use Services.'
    )
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'ComfyUI install check failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'COMFYUI_INSTALL_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
