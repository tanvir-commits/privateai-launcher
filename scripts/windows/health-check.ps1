param(
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Test-HttpOk {
    param(
        [string]$Url,
        [int]$TimeoutSec = 5
    )
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    }
    catch {
        return $false
    }
}

function Test-HttpOkCurl {
    param(
        [string]$Url,
        [int]$TimeoutSec = 12
    )
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (-not (Test-Path -LiteralPath $curl)) {
        return $false
    }
    try {
        $codeTxt = & $curl @('-sS', '-o', 'NUL', '-w', '%{http_code}', '--max-time', "$TimeoutSec", $Url) 2>$null
        if ([string]::IsNullOrWhiteSpace($codeTxt)) {
            return $false
        }
        $n = [int][string]$codeTxt.Trim()
        return ($n -ge 200 -and $n -lt 500)
    }
    catch {
        return $false
    }
}

function Test-UrlReachable {
    param(
        [string]$Url,
        [int]$TimeoutSec
    )
    # curl often agrees with the browser when Invoke-WebRequest mis-parses or stalls on SPA/HTML.
    if (Test-HttpOkCurl -Url $Url -TimeoutSec $TimeoutSec) {
        return $true
    }
    return (Test-HttpOk -Url $Url -TimeoutSec $TimeoutSec)
}

<#
    Open WebUI cold-starts slowly; the SPA root can choke Invoke-WebRequest while the browser still works.
    Prefer small endpoints (/health, /api/health), try 127.0.0.1 and localhost, try curl before Invoke-WebRequest,
    then retries for slow binds.
#>

function Test-OpenWebUiReachable {
    param(
        [int]$Port,
        [int]$Attempts = 3,
        [int]$TimeoutSec = 8,
        [int]$DelaySec = 2
    )
    $hosts = @('127.0.0.1', 'localhost')
    $paths = @('/health', '/api/health', '/')
    for ($a = 0; $a -lt $Attempts; $a++) {
        foreach ($h in $hosts) {
            $base = "http://${h}:$Port"
            foreach ($path in $paths) {
                $url = if ($path -eq '/') { "$base/" } else { ($base.TrimEnd('/') + $path) }
                # Small JSON endpoints: curl only (Invoke-WebRequest can stall on large SPA bodies).
                if ($path -ne '/') {
                    if (Test-HttpOkCurl -Url $url -TimeoutSec $TimeoutSec) {
                        return $true
                    }
                }
                elseif (Test-UrlReachable -Url $url -TimeoutSec $TimeoutSec) {
                    return $true
                }
            }
        }
        if ($a -lt ($Attempts - 1)) {
            Start-Sleep -Seconds $DelaySec
        }
    }
    return $false
}

<#
    Resolves privateai-open-webui or another container publishing HostPort (Open WebUI image).
    Returns: State no_docker|missing|stopped|running|unknown, ActualName, DiscoveryNote.
#>
function Get-OpenWebUiContainerDiagnostics {
    param(
        [string]$DockerExe,
        [int]$HostPort
    )
    $preferred = 'privateai-open-webui'
    $discoveryNote = $null
    $actualName = $null

    if ([string]::IsNullOrWhiteSpace($DockerExe)) {
        return [pscustomobject]@{
            State         = 'no_docker'
            PreferredName = $preferred
            ActualName    = $null
            DiscoveryNote = $null
        }
    }

    function Read-RunningInspect([string]$N) {
        return Invoke-PrivateAIDocker -DockerExePath $DockerExe -ArgList @('inspect', '-f', '{{.State.Running}}', $N) -OutputCharLimit 800
    }

    $insp = Read-RunningInspect -N $preferred
    if ($insp.ExitCode -eq 0) {
        $actualName = $preferred
    }
    else {
        $alt = Resolve-PrivateAIOpenWebUiContainerName -DockerExePath $DockerExe -HostPort $HostPort
        if (-not [string]::IsNullOrWhiteSpace($alt)) {
            $actualName = $alt
            if ($alt -ne $preferred) {
                $discoveryNote = "Found container '$alt' publishing port $HostPort (canonical '$preferred' was not found on this engine)."
            }
            $insp = Read-RunningInspect -N $alt
        }
    }

    if ($insp.ExitCode -ne 0) {
        return [pscustomobject]@{
            State         = 'missing'
            PreferredName = $preferred
            ActualName    = $actualName
            DiscoveryNote = $discoveryNote
        }
    }

    $txt = (Get-PrivateAINormalizedConsoleText $insp.Output).Trim()
    if ($txt -match '^\s*true\s*$') {
        if ([string]::IsNullOrWhiteSpace($actualName)) { $actualName = $preferred }
        return [pscustomobject]@{
            State         = 'running'
            PreferredName = $preferred
            ActualName    = $actualName
            DiscoveryNote = $discoveryNote
        }
    }
    if ($txt -match '^\s*false\s*$') {
        if ([string]::IsNullOrWhiteSpace($actualName)) { $actualName = $preferred }
        return [pscustomobject]@{
            State         = 'stopped'
            PreferredName = $preferred
            ActualName    = $actualName
            DiscoveryNote = $discoveryNote
        }
    }
    if ([string]::IsNullOrWhiteSpace($actualName)) { $actualName = $preferred }
    return [pscustomobject]@{
        State         = 'unknown'
        PreferredName = $preferred
        ActualName    = $actualName
        DiscoveryNote = $discoveryNote
    }
}

function Get-LanIPv4 {
    try {
        foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            if ($ni.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) {
                continue
            }
            foreach ($ua in $ni.GetIPProperties().UnicastAddresses) {
                $a = $ua.Address
                if ($a.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
                    continue
                }
                $s = $a.ToString()
                if ($s -like '127.*' -or $s -like '169.254.*') {
                    continue
                }
                return $s
            }
        }
    }
    catch {
        return $null
    }
    return $null
}

try {
    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 12 -Detail 'HTTP probes'

    $ports = Get-PortsConfig
    $ollamaPort = [int]$ports.ollama
    $owPort = [int]$ports.openWebui
    $comfyPort = [int]$ports.comfyui

    $ollamaUrl = "http://127.0.0.1:$ollamaPort/api/tags"
    $owUrl = "http://localhost:$owPort/"
    $comfyUrl = "http://127.0.0.1:$comfyPort/"

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 22 -Detail 'Docker engine'

    $dockerExe = Get-DockerExecutablePath
    $dockerEngineOk = $false
    $dockerVersion = $null
    if (-not [string]::IsNullOrWhiteSpace($dockerExe)) {
        $dv = Get-PrivateAIDockerServerVersion -DockerExePath $dockerExe
        if (-not [string]::IsNullOrWhiteSpace($dv)) {
            $dockerEngineOk = $true
            $dockerVersion = [string]$dv
        }
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 35 -Detail 'Ollama'

    $ollamaOk = Test-HttpOk -Url $ollamaUrl -TimeoutSec 8

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 58 -Detail 'Open WebUI'

    $owDiag = Get-OpenWebUiContainerDiagnostics -DockerExe $dockerExe -HostPort $owPort
    $owContainerState = [string]$owDiag.State
    $owResolvedName = $owDiag.ActualName

    if ($owContainerState -eq 'running') {
        $owHttpOk = Test-OpenWebUiReachable -Port $owPort -Attempts 2 -TimeoutSec 7 -DelaySec 2
    }
    elseif ($owContainerState -eq 'missing' -or $owContainerState -eq 'no_docker') {
        $owHttpOk = $false
    }
    else {
        $owHttpOk = Test-OpenWebUiReachable -Port $owPort -Attempts 1 -TimeoutSec 5 -DelaySec 0
    }

    $owContainerOk = ($owContainerState -eq 'running')
    $owProbeNote = $null
    if (-not $owHttpOk -and $owContainerOk) {
        $dn = if (-not [string]::IsNullOrWhiteSpace($owResolvedName)) { $owResolvedName } else { 'privateai-open-webui' }
        $owProbeNote = "HTTP probe did not get a clean response, but Docker reports ${dn} is running. If the UI opens in your browser, the stack is fine."
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 78 -Detail 'ComfyUI (optional)'

    $comfyOk = Test-HttpOk -Url $comfyUrl -TimeoutSec 8

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

    $suggestedRepairCode = $null
    if (-not $owHttpOk) {
        if ([string]$owContainerState -eq 'running') {
            $issues += "Open Web UI container is up but http://localhost:$owPort did not respond (still starting, crash loop, or wrong port). Check Docker logs for the Open WebUI container."
        }
        else {
            switch ([string]$owContainerState) {
                'stopped' {
                    $issues += 'Open Web UI is installed but the Docker container (privateai-open-webui) is stopped. Start it in Docker Desktop, use the Dashboard Open WebUI Restart, Troubleshooting (Open WebUI container stopped), or re-run Install / verify Open Web UI in the wizard.'
                    $suggestedRepairCode = 'OPENWEBUI_CONTAINER_STOPPED'
                }
                'missing' {
                    if (-not [string]::IsNullOrWhiteSpace($owDiag.ActualName)) {
                        $issues += "Open Web UI container '$($owDiag.ActualName)' exists on port $owPort but Docker inspect failed (try quitting Docker Desktop fully and reopening, or run Install / verify Open Web UI)."
                    }
                    else {
                        $issues += 'Open Web UI has no container yet. Run Install / verify Open Web UI in the Install Wizard.'
                    }
                }
                'no_docker' {
                    $issues += 'Open Web UI could not be checked (Docker CLI unavailable or engine not responding).'
                }
                default {
                    $issues += "Open Web UI did not answer on http://localhost:$owPort (HTTP probe failed and the container is not running)."
                }
            }
        }
    }

    $coreOk = $issues.Count -eq 0

    # Only mention Comfy when the chat stack passed — avoids looking like a second "failure" on core issues.
    $optionalExtras = @()
    if ($coreOk -and (-not $comfyOk)) {
        $optionalExtras += 'ComfyUI is not reachable (optional unless you use image workflows). Install from ComfyUI extras in the wizard when ready.'
    }
    $msg = if (-not $coreOk) {
        'Some core checks failed.'
    }
    elseif (-not $comfyOk) {
        'Core stack healthy. ComfyUI is optional and was not detected.'
    }
    else {
        'All checks passed (including ComfyUI).'
    }

    $openWebUiDetails = [ordered]@{
        running          = [bool]$owHttpOk
        url              = "http://localhost:$owPort"
        httpProbeOk      = [bool]$owHttpOk
        containerState   = [string]$owContainerState
    }
    if (-not [string]::IsNullOrWhiteSpace($owResolvedName)) {
        $openWebUiDetails['containerName'] = [string]$owResolvedName
    }
    if (-not [string]::IsNullOrWhiteSpace($owDiag.DiscoveryNote)) {
        $openWebUiDetails['discoveryNote'] = [string]$owDiag.DiscoveryNote
    }
    if (-not $owHttpOk) {
        $openWebUiDetails['containerRunning'] = [bool]$owContainerOk
        if (-not [string]::IsNullOrWhiteSpace($owProbeNote)) {
            $openWebUiDetails['probeNote'] = [string]$owProbeNote
        }
    }

    $details = [ordered]@{
        docker         = [pscustomobject]@{ running = [bool]$dockerEngineOk; version = $dockerVersion }
        ollama         = [pscustomobject]@{ running = [bool]$ollamaOk; url = "http://localhost:$ollamaPort"; models = $models }
        openWebui      = [pscustomobject]$openWebUiDetails
        comfyui        = [pscustomobject]@{ running = [bool]$comfyOk; url = "http://localhost:$comfyPort"; optional = $true }
        phoneAccess    = [pscustomobject]@{ lanIp = $lan; url = $phoneUrl }
        issues         = $issues
        optionalExtras = $optionalExtras
    }
    if ($null -ne $suggestedRepairCode) {
        $details['suggestedRepairCode'] = [string]$suggestedRepairCode
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase checking -Pct 100 -Detail $(if ($coreOk) {
            'OK'
        }
        else {
            'Issues'
        })

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
