param(
    [ValidateSet('nvidia', 'nvidia_cu126', 'amd')]
    [string]$Variant = 'nvidia',
    [string]$ProgressFile = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

$script:paProgLast = [datetime]::MinValue

function Emit-Prog {
    param(
        [ValidateSet('download', 'extract', 'starting')]
        [string]$Phase,
        $Pct
    )
    if ([string]::IsNullOrWhiteSpace($ProgressFile)) {
        return
    }
    $now = [datetime]::UtcNow
    if (($now - $script:paProgLast).TotalMilliseconds -lt 200) {
        return
    }
    $script:paProgLast = $now
    $obj = [ordered]@{
        phase = $Phase
        pct   = $null
    }
    if ($null -ne $Pct) {
        $n = [int]$Pct
        $obj.pct = [int][Math]::Max(0, [Math]::Min(100, $n))
    }
    $json = ($obj | ConvertTo-Json -Compress)
    Set-Content -LiteralPath $ProgressFile -Value $json -Encoding utf8 -Force
}

function Get-SevenZipPath {
    $fromPath = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if ($null -ne $fromPath) {
        return [string]$fromPath.Source
    }

    $roots = @($env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'))
    foreach ($r in $roots) {
        if ([string]::IsNullOrWhiteSpace($r)) { continue }
        $p = Join-Path $r '7-Zip\7z.exe'
        if (Test-Path -LiteralPath $p) {
            return [string]$p
        }
    }
    return $null
}

function Install-SevenZipWithWinget {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($null -eq $winget) {
        return $null
    }
    try {
        $wa = @(
            'install', '-e', '--id', '7zip.7zip', '--silent',
            '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
        )
        $p = Start-Process -FilePath 'winget.exe' -ArgumentList $wa -Wait -PassThru -NoNewWindow
        if ($null -ne $p.ExitCode -and [int]$p.ExitCode -ne 0) {
            return $null
        }
    }
    catch {
        return $null
    }
    return Get-SevenZipPath
}

function Get-PortableAssetName {
    param([ValidateSet('nvidia', 'nvidia_cu126', 'amd')][string]$Variant)
    switch ($Variant) {
        'nvidia' { return 'ComfyUI_windows_portable_nvidia.7z' }
        'nvidia_cu126' { return 'ComfyUI_windows_portable_nvidia_cu126.7z' }
        'amd' { return 'ComfyUI_windows_portable_amd.7z' }
        default { return 'ComfyUI_windows_portable_nvidia.7z' }
    }
}

function Find-ComfyPortableRoot {
    param(
        [Parameter(Mandatory)][string]$SearchDir,
        [ValidateSet('nvidia', 'nvidia_cu126', 'amd')][string]$Variant
    )
    $names = if ($Variant -eq 'amd') {
        @('run_amd_gpu.bat', 'run_nvidia_gpu.bat', 'run_cpu.bat')
    }
    else {
        @('run_nvidia_gpu.bat', 'run_amd_gpu.bat', 'run_cpu.bat')
    }

    foreach ($n in $names) {
        $hit = Get-ChildItem -LiteralPath $SearchDir -Recurse -Filter $n -File -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $hit) {
            return [string]$hit.Directory.FullName
        }
    }
    return $null
}

function Add-ListenZeroToLaunchBat {
    param([Parameter(Mandatory)][string]$BatPath)
    if (-not (Test-Path -LiteralPath $BatPath)) {
        return $false
    }

    $lines = Get-Content -LiteralPath $BatPath
    $out = foreach ($ln in $lines) {
        $t = [string]$ln
        if (($t -match 'python\.exe') -and ($t -match 'ComfyUI\\main\.py') -and ($t -notmatch '--listen')) {
            if ($t.TrimEnd().EndsWith('`')) {
                $t
            }
            else {
                $t.TrimEnd() + ' --listen 0.0.0.0'
            }
        }
        else {
            $t
        }
    }
    Set-Content -LiteralPath $BatPath -Value $out -Encoding utf8
    return $true
}

function Patch-AllComfyLaunchBats {
    param([Parameter(Mandatory)][string]$DeployDir)
    Get-ChildItem -LiteralPath $DeployDir -Filter 'run_*.bat' -File -ErrorAction SilentlyContinue |
        ForEach-Object { [void](Add-ListenZeroToLaunchBat -BatPath $_.FullName) }
}

function Resolve-ComfyLaunchBat {
    param(
        [Parameter(Mandatory)][string]$DeployDir,
        [ValidateSet('nvidia', 'nvidia_cu126', 'amd')][string]$Variant
    )
    $order = if ($Variant -eq 'amd') {
        @('run_amd_gpu.bat', 'run_nvidia_gpu.bat', 'run_cpu.bat')
    }
    else {
        @('run_nvidia_gpu.bat', 'run_amd_gpu.bat', 'run_cpu.bat')
    }
    foreach ($n in $order) {
        $p = Join-Path $DeployDir $n
        if (Test-Path -LiteralPath $p) {
            return [string]$p
        }
    }
    return $null
}

function Invoke-BitsDownload {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Destination
    )
    Import-Module BitsTransfer -ErrorAction Stop
    $job = Start-BitsTransfer -Source $Url -Destination $Destination -Priority High -Asynchronous -ErrorAction Stop
    $jid = $job.JobId
    while ($true) {
        $cur = Get-BitsTransfer -JobId $jid -ErrorAction SilentlyContinue
        if ($null -eq $cur) {
            throw 'BITS job was lost'
        }
        $state = $cur.JobState.ToString()
        if ($state -eq 'Error' -or $state -eq 'Transient_Error') {
            throw "BITS state: $state"
        }
        if ($state -eq 'Transferred') {
            $script:paProgLast = [datetime]::MinValue
            Emit-Prog -Phase 'download' -Pct 100
            break
        }
        $pct = $null
        if ($cur.BytesTotal -gt 0) {
            $raw = 100.0 * [double]$cur.BytesTransferred / [double]$cur.BytesTotal
            $pct = [int][Math]::Floor($raw)
            if ($pct -gt 99) { $pct = 99 }
        }
        Emit-Prog -Phase 'download' -Pct $pct
        Start-Sleep -Milliseconds 400
    }
    Complete-BitsTransfer -BitsJob $cur
}

function Invoke-StreamDownload {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Destination
    )
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method = 'GET'
    $req.AllowAutoRedirect = $true
    $req.UserAgent = 'PrivateAI-Launcher/1.0'
    $req.Timeout = 7200000
    $resp = $req.GetResponse()
    try {
        $total = [int64]$resp.ContentLength
        $rs = $resp.GetResponseStream()
        $fs = [System.IO.File]::Create($Destination)
        try {
            $buf = New-Object byte[] 65536
            $got = [int64]0
            $read = $rs.Read($buf, 0, $buf.Length)
            while ($read -gt 0) {
                $fs.Write($buf, 0, $read)
                $got += $read
                $pct = $null
                if ($total -gt 0) {
                    $pct = [int][Math]::Floor(100.0 * [double]$got / [double]$total)
                    if ($pct -gt 99) { $pct = 99 }
                }
                Emit-Prog -Phase 'download' -Pct $pct
                $read = $rs.Read($buf, 0, $buf.Length)
            }
        }
        finally {
            $fs.Close()
            $rs.Close()
        }
    }
    finally {
        $resp.Close()
    }
    $script:paProgLast = [datetime]::MinValue
    Emit-Prog -Phase 'download' -Pct 100
}

try {
    $ports = Get-PortsConfig
    $port = [int]$ports.comfyui

    try {
        $respProbe = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 3
        if ($respProbe.StatusCode -ge 200 -and $respProbe.StatusCode -lt 500) {
            $payload = New-ScriptResult -Ok $true -Status success -Message 'ComfyUI is already running on this computer; no download was needed.' -Details @{
                url = "http://localhost:$port"
            }
            Write-Output (Write-ScriptJson $payload)
            exit 0
        }
    }
    catch { }

    $seven = Get-SevenZipPath
    if ($null -eq $seven) {
        $seven = Install-SevenZipWithWinget
    }
    if ($null -eq $seven) {
        $payload = New-ScriptResult -Ok $false -Status error -Message '7-Zip is required to unpack ComfyUI. The launcher tried to install it quietly; you can also install 7-Zip from the Microsoft Store.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'SEVENZIP_MISSING'; message = '7z.exe not found after winget attempt' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $asset = Get-PortableAssetName -Variant $Variant
    $url = "https://github.com/comfyanonymous/ComfyUI/releases/latest/download/$asset"

    $localBase = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PrivateAI'
    if (-not (Test-Path -LiteralPath $localBase)) {
        New-Item -ItemType Directory -Path $localBase -Force | Out-Null
    }

    $deployDir = Join-Path $localBase 'ComfyUI_windows_portable'
    $archive = Join-Path $env:TEMP "privateai_$([Guid]::NewGuid().ToString('n'))_$asset"
    $staging = Join-Path $env:TEMP "privateai_comfy_extract_$([Guid]::NewGuid().ToString('n'))"
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    Emit-Prog -Phase 'download' -Pct 0

    $bitsOk = $false
    try {
        Invoke-BitsDownload -Url $url -Destination $archive
        $bitsOk = $true
    }
    catch {
        $bitsOk = $false
    }
    if (-not $bitsOk) {
        try {
            Invoke-StreamDownload -Url $url -Destination $archive
        }
        catch {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
            $payload = New-ScriptResult -Ok $false -Status error -Message 'Downloading ComfyUI failed. Check your internet connection and try again.' -Details @{
                url = [string]$url
            } -Errors @(
                [pscustomobject]@{ code = 'COMFYUI_DOWNLOAD_FAILED'; message = [string]$_.Exception.Message }
            )
            Write-Output (Write-ScriptJson $payload)
            exit 1
        }
    }

    if (-not (Test-Path -LiteralPath $archive)) {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Download finished but the archive file is missing.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'COMFYUI_DOWNLOAD_FAILED'; message = 'archive missing' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    Emit-Prog -Phase 'extract'

    $pExtract = Start-Process -FilePath $seven `
        -ArgumentList @('x', $archive, "-o$staging", '-y') `
        -Wait -PassThru -NoNewWindow
    if ($null -eq $pExtract.ExitCode -or [int]$pExtract.ExitCode -ne 0) {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        $payload = New-ScriptResult -Ok $false -Status error -Message 'Unpacking ComfyUI failed (7-Zip reported an error).' -Details @{
            exitCode = $pExtract.ExitCode
        } -Errors @(
            [pscustomobject]@{ code = 'COMFYUI_EXTRACT_FAILED'; message = '7z exit non-zero' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $root = Find-ComfyPortableRoot -SearchDir $staging -Variant $Variant
    if ([string]::IsNullOrWhiteSpace($root)) {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        $payload = New-ScriptResult -Ok $false -Status error -Message 'The downloaded package did not look like a ComfyUI portable folder.' -Details @{} -Errors @(
            [pscustomobject]@{ code = 'COMFYUI_LAYOUT_UNKNOWN'; message = 'Expected run_*.bat not found after extract' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    if (Test-Path -LiteralPath $deployDir) {
        Remove-Item -LiteralPath $deployDir -Recurse -Force -ErrorAction Stop
    }
    Move-Item -LiteralPath $root -Destination $deployDir -Force

    Patch-AllComfyLaunchBats -DeployDir $deployDir

    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue

    $launchBat = Resolve-ComfyLaunchBat -DeployDir $deployDir -Variant $Variant
    $warnings = [System.Collections.Generic.List[string]]::new()
    $ready = $false

    if ($null -ne $launchBat -and (Test-Path -LiteralPath $launchBat)) {
        Emit-Prog -Phase 'starting'
        Start-Process -FilePath $launchBat -WorkingDirectory $deployDir -WindowStyle Minimized

        $deadline = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $deadline) {
            try {
                $rHttp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2
                if ($rHttp.StatusCode -ge 200 -and $rHttp.StatusCode -lt 500) {
                    $ready = $true
                    break
                }
            }
            catch { }
            Emit-Prog -Phase 'starting'
            Start-Sleep -Milliseconds 700
        }

        if (-not $ready) {
            [void]$warnings.Add('ComfyUI was started in the background but did not respond yet. The first launch can take a few minutes; check the minimized window or try again later.')
        }
    }
    else {
        [void]$warnings.Add('No ComfyUI start script was found in the install folder.')
    }

    $status = if ($warnings.Count -gt 0) { 'warning' } else { 'success' }
    $msg = if ($ready) {
        'ComfyUI is installed and running. It was opened minimized; you can keep using this launcher while it works in the background.'
    }
    elseif ($warnings.Count -gt 0) {
        'ComfyUI files are installed. See the note below; the app may still be starting.'
    }
    else {
        'ComfyUI portable install finished.'
    }

    $payload = New-ScriptResult -Ok $true -Status $status -Message $msg -Details @{
        installDir    = [string]$deployDir
        launchBat     = [string]$launchBat
        variant       = [string]$Variant
        downloadUrl   = [string]$url
        comfyUrl      = "http://localhost:$port"
        comfyReady    = [bool]$ready
        listenPatched = $true
    } -Warnings @([string[]]$warnings.ToArray())
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'ComfyUI portable install failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'COMFYUI_PORTABLE_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
