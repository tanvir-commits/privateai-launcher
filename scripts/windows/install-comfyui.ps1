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

    # Probe-only: not installed is normal unless the user opted into Comfy workflows.
    # ok=true success + no warnings so optional wizard steps stay green until Comfy answers on the port.
    $payload = New-ScriptResult -Ok $true -Status success -Message 'ComfyUI is not detected on localhost (normal until you install/start it on this port).' -Details @{
        url        = "http://localhost:$port"
        comfyGuide = 'https://docs.comfy.org/get_started/pre_package'
    }
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
