. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Test-HttpOk {
    param([string]$Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    }
    catch {
        return $false
    }
}

function Get-LanIPv4 {
    try {
        $picked = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*'
        } |
        Sort-Object InterfaceMetric |
        Select-Object -First 1

        if ($null -eq $picked) { return $null }
        return [string]$picked.IPAddress
    }
    catch {
        return $null
    }
}

try {
    $ports = Get-PortsConfig
    $ollamaPort = [int]$ports.ollama
    $owPort = [int]$ports.openWebui
    $comfyPort = [int]$ports.comfyui

    $ollamaUrl = "http://127.0.0.1:$ollamaPort/api/tags"
    $owUrl = "http://127.0.0.1:$owPort/"
    $comfyUrl = "http://127.0.0.1:$comfyPort/"

    $ollamaOk = Test-HttpOk -Url $ollamaUrl
    $owOk = Test-HttpOk -Url $owUrl
    $comfyOk = Test-HttpOk -Url $comfyUrl

    $models = @()
    if ($ollamaOk) {
        try {
            $tags = (Invoke-WebRequest -Uri $ollamaUrl -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
            if ($null -ne $tags.models) { $models = @($tags.models | ForEach-Object { $_.name }) }
        }
        catch { }
    }

    $lan = Get-LanIPv4
    $phoneUrl = $null
    if (-not [string]::IsNullOrWhiteSpace($lan)) {
        $phoneUrl = "http://$($lan):$owPort"
    }

    # Core stack = Ollama + Open WebUI. ComfyUI is optional (image workflows).
    $issues = @()
    if (-not $ollamaOk) { $issues += 'Ollama API not reachable' }
    if (-not $owOk) { $issues += 'Open WebUI not reachable' }

    $optionalExtras = @()
    if (-not $comfyOk) {
        $optionalExtras += 'ComfyUI is not reachable (optional unless you use image workflows). Install from ComfyUI extras in the wizard when ready.'
    }

    $coreOk = $issues.Count -eq 0
    $msg = if (-not $coreOk) {
        'Some core checks failed.'
    }
    elseif (-not $comfyOk) {
        'Core stack healthy. ComfyUI is optional and was not detected.'
    }
    else {
        'All checks passed (including ComfyUI).'
    }

    $details = [ordered]@{
        ollama        = [pscustomobject]@{ running = [bool]$ollamaOk; url = "http://localhost:$ollamaPort"; models = $models }
        openWebui     = [pscustomobject]@{ running = [bool]$owOk; url = "http://localhost:$owPort" }
        comfyui       = [pscustomobject]@{ running = [bool]$comfyOk; url = "http://localhost:$comfyPort"; optional = $true }
        phoneAccess   = [pscustomobject]@{ lanIp = $lan; url = $phoneUrl }
        issues        = $issues
        optionalExtras = $optionalExtras
    }

    $payload = New-ScriptResult -Ok $coreOk -Status $(if ($coreOk) { 'success' } else { 'warning' }) -Message $msg -Details ([pscustomobject]$details)
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Health check failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'HEALTH_CHECK_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
