param(
    [string]$LogDir = ''
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Write-LogLine {
    param([string]$Line)
    if ([string]::IsNullOrWhiteSpace($LogDir)) { return }
    try {
        $dir = $LogDir
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        $path = Join-Path $dir 'privateai-launcher.log'
        Add-Content -LiteralPath $path -Value ("{0} {1}" -f (Get-Date).ToString('o'), $Line)
    }
    catch { }
}

try {
    $os = Get-CimInstance Win32_OperatingSystem
    $cs = Get-CimInstance Win32_ComputerSystem

    $build = [int]$os.BuildNumber
    $ramBytes = [int64]$cs.TotalPhysicalMemory

    $cDrive = Get-PSDrive -Name 'C' -ErrorAction SilentlyContinue
    $diskFree = $null
    if ($null -ne $cDrive) {
        $diskFree = [int64]$cDrive.Free
    }

    $ports = Get-PortsConfig
    $portChecks = [ordered]@{}
    foreach ($p in @(
            @{ name = 'ollama'; port = [int]$ports.ollama },
            @{ name = 'openWebui'; port = [int]$ports.openWebui },
            @{ name = 'comfyui'; port = [int]$ports.comfyui }
        )) {
        $free = Test-TcpPortFree -Port $p.port
        $portChecks[$p.name] = [pscustomobject]@{ port = $p.port; free = [bool]$free }
    }

    $warnings = @()
    if ($ramBytes -lt 8GB) { $warnings += 'Less than 8 GB RAM detected.' }
    if ($null -ne $diskFree -and $diskFree -lt 50GB) { $warnings += 'Less than 50 GB free on C:.' }

    $details = [ordered]@{
        osCaption     = $os.Caption
        osBuild       = $build
        ramBytes      = $ramBytes
        diskCFreeBytes = $diskFree
        ports         = [pscustomobject]$portChecks
    }

    $msg = 'System scan complete.'
    Write-LogLine $msg

    $payload = New-ScriptResult -Ok $true -Status success -Message $msg -Details ([pscustomobject]$details) -Warnings $warnings
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'System scan failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'SYSTEM_SCAN_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
