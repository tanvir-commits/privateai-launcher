param(
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

try {
    $exe0 = Get-OllamaExecutablePath
    if ($null -ne $exe0) {
        $ov0 = Get-PrivateAIOllamaVersionLine $exe0
        $payload = New-ScriptResult -Ok $true -Status success -Message 'Ollama is already installed.' -Details @{
            path                   = [string]$exe0
            ollamaVersion          = $ov0
            alreadyInstalledProbe  = $true
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

    function Wait-WingetInstallOllamaProgress {
        param(
            [Parameter(Mandatory)][string[]]$ArgumentList,
            [ValidateRange(0, 99)][int]$PctFrom,
            [ValidateRange(1, 100)][int]$PctTo,
            [string]$Detail,
            [double]$RampSeconds = 2100.0
        )
        $p = Start-Process -FilePath 'winget.exe' -ArgumentList $ArgumentList -PassThru -NoNewWindow
        if ($null -eq $p) { return }
        $t0 = Get-Date
        while (-not $p.HasExited) {
            $p.Refresh()
            $el = ((Get-Date) - $t0).TotalSeconds
            $span = [Math]::Min(1.0, $el / [Math]::Max(60.0, $RampSeconds))
            $pct = [int][Math]::Min($PctTo, [Math]::Floor($PctFrom + $span * ([double]($PctTo - $PctFrom))))
            Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase winget -Pct $pct -Detail $Detail
            Start-Sleep -Seconds 2
        }
        try {
            $null = $p.WaitForExit()
        }
        catch { }
    }

    Wait-WingetInstallOllamaProgress -ArgumentList $silent -PctFrom 5 -PctTo 58 `
        -Detail 'winget: downloading & installing Ollama (no real % from installer)'

    Start-Sleep -Seconds 5
    if ($null -eq (Get-OllamaExecutablePath)) {
        Start-Sleep -Seconds 25
        if ($null -eq (Get-OllamaExecutablePath)) {
            Wait-WingetInstallOllamaProgress -ArgumentList $shown -PctFrom 20 -PctTo 60 `
                -Detail 'winget: retry with minimal UI'
        }
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase install -Pct 65 -Detail 'Waiting for installer to finish copying files'

    $deadExe = (Get-Date).AddMinutes(18)
    $exeWait0 = Get-Date
    while ($null -eq (Get-OllamaExecutablePath) -and ((Get-Date) -lt $deadExe)) {
        $elapsed = ((Get-Date) - $exeWait0).TotalSeconds
        $pct = [int][Math]::Min(90, [Math]::Floor((65 + ($elapsed / 1080 * 22)))) # up to ~22 points over ~18min
        Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase install -Pct $pct -Detail 'Searching for Ollama after install'
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

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase starting -Pct 92 -Detail 'Starting Ollama'

    Start-PrivateAIOllamaIfInstalled

    $ports = Get-PortsConfig
    $listen = [int]$ports.ollama
    $apiOk = $false
    $apiDeadline = (Get-Date).AddSeconds(120)
    $api0 = Get-Date
    while ((Get-Date) -lt $apiDeadline) {
        try {
            $null = Invoke-WebRequest -Uri "http://127.0.0.1:$listen/api/tags" -UseBasicParsing -TimeoutSec 5
            $apiOk = $true
            break
        }
        catch {
            $aEl = ((Get-Date) - $api0).TotalSeconds
            $aPct = [int][Math]::Min(98, [Math]::Floor((92 + ($aEl / 120 * 6))))
            Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase starting -Pct $aPct -Detail 'Waiting for Ollama API'
            Start-Sleep -Milliseconds 750
        }
    }

    Write-PrivateAIProgressFile -ProgressFile $ProgressFile -Phase starting -Pct 100 -Detail 'Ollama ready'

    $warnings = @()
    if (-not $apiOk) {
        $warnings += 'Ollama was installed but the API did not respond in time. Open Ollama from the Start menu once, then re-run Download models from the launcher if pulls fail.'
    }

    $st = if ($warnings.Count -gt 0) { 'warning' } else { 'success' }
    $ov = Get-PrivateAIOllamaVersionLine $exe
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
        ollamaVersion = $ov
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
