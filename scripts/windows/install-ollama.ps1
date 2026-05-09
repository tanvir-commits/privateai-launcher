. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $exe0 = Get-OllamaExecutablePath
    if ($null -ne $exe0) {
        $payload = New-ScriptResult -Ok $true -Status success -Message 'Ollama is already installed.' -Details @{
            path = [string]$exe0
        }
        Write-Output (Write-ScriptJson $payload)
        exit 0
    }

    $wingetExe = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($null -eq $wingetExe) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'winget is not available on this PATH. Install the App Installer / Microsoft Store winget CLI, then re-run this step, or install Ollama from https://ollama.com/download/windows' -Details @{
            downloadUrl = 'https://ollama.com/download/windows'
        } -Errors @(
            [pscustomobject]@{ code = 'WINGET_MISSING'; message = 'winget.exe not found' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Update-PrivateAIPathFromRegistry

    # Silent install preferred for launcher UX; retries without --silent if the installer rejects it (rare).
    $silent = @(
        'install', '-e', '--id', 'Ollama.Ollama', '--silent',
        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
    )
    $shown = @(
        'install', '-e', '--id', 'Ollama.Ollama',
        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
    )

    function Invoke-WingetInstallOllama {
        param([string[]]$ArgumentList)
        return (Start-Process -FilePath 'winget.exe' -ArgumentList $ArgumentList -Wait -PassThru -NoNewWindow)
    }

    $null = Invoke-WingetInstallOllama -ArgumentList $silent
    Start-Sleep -Seconds 5
    if ($null -eq (Get-OllamaExecutablePath)) {
        Start-Sleep -Seconds 25
        if ($null -eq (Get-OllamaExecutablePath)) {
            # Some builds ignore --silent; try a minimally interactive winget invocation once more.
            $null = Invoke-WingetInstallOllama -ArgumentList $shown
        }
    }

    $deadExe = (Get-Date).AddMinutes(18)
    while ($null -eq (Get-OllamaExecutablePath) -and ((Get-Date) -lt $deadExe)) {
        Start-Sleep -Seconds 3
    }

    $exe = Get-OllamaExecutablePath
    if ([string]::IsNullOrWhiteSpace($exe)) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Automatic Ollama install did not succeed. Visit https://ollama.com/download/windows or run: winget install Ollama.Ollama --accept-package-agreements' -Details @{
            attemptedId = 'Ollama.Ollama'
            downloadUrl = 'https://ollama.com/download/windows'
        } -Errors @(
            [pscustomobject]@{ code = 'OLLAMA_INSTALL_RUN_FAILED'; message = 'winget ran but ollama.exe never appeared under standard locations' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Start-PrivateAIOllamaIfInstalled

    $ports = Get-PortsConfig
    $listen = [int]$ports.ollama
    $apiOk = $false
    $apiDeadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $apiDeadline) {
        try {
            $null = Invoke-WebRequest -Uri "http://127.0.0.1:$listen/api/tags" -UseBasicParsing -TimeoutSec 5
            $apiOk = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 750
        }
    }

    $warnings = @()
    if (-not $apiOk) {
        $warnings += 'Ollama was installed but the API did not respond in time. Open Ollama from the Start menu once, then re-run Download models from the launcher if pulls fail.'
    }

    $st = if ($warnings.Count -gt 0) { 'warning' } else { 'success' }
    $payload = New-ScriptResult -Ok $true -Status $st -Message $(if ($apiOk) {
            'Ollama was installed and the API responded.'
        }
        else {
            'Ollama was installed. See the warning if the API is still waking up.'
        }) -Details @{
        path           = [string]$exe
        installMethod = 'winget'
        apiReady      = [bool]$apiOk
        port          = $listen
    } -Warnings @($warnings)

    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Ollama install script failed unexpectedly.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'OLLAMA_INSTALL_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
