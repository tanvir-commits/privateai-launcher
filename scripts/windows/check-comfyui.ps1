. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $ports = Get-PortsConfig
    $port = [int]$ports.comfyui
    $url = "http://127.0.0.1:$port/"

    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        $ok = $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500
        if (-not $ok) { throw "Unexpected status $($resp.StatusCode)" }

        $payload = New-ScriptResult -Ok $true -Status success -Message 'ComfyUI is reachable.' -Details @{
            url = "http://localhost:$port"
        }
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }
    catch {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'ComfyUI is not reachable on localhost.' -Details @{
            url = "http://localhost:$port"
        } -Errors @([pscustomobject]@{ code = 'COMFYUI_NOT_RUNNING'; message = $_.Exception.Message })
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'ComfyUI check failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'COMFYUI_CHECK_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
