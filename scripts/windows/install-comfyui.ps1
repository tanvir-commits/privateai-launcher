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

    $payload = New-ScriptResult -Ok $false -Status warning -Message 'ComfyUI is not detected on localhost. Install ComfyUI Desktop or portable, then enable --listen on port 8188.' -Details @{
        url        = "http://localhost:$port"
        comfyGuide = 'https://github.com/comfyanonymous/ComfyUI'
    } -Errors @(
        [pscustomobject]@{ code = 'COMFYUI_INSTALL_REQUIRED'; message = 'User action required: install/start ComfyUI.' }
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
