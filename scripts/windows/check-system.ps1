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

    $virtFw = $null
    $vmMon = $null
    try {
        $p0 = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $p0) {
            $virtFw = $p0.VirtualizationFirmwareEnabled
            $vmMon = $p0.VMMonitorModeExtensions
        }
    }
    catch { }

    $hypervisorPresent = $null
    try {
        $hypervisorPresent = [bool]$cs.HypervisorPresent
    }
    catch { }

    $warnings = @()
    if ($ramBytes -lt 8GB) { $warnings += 'Less than 8 GB RAM detected.' }
    if ($null -ne $diskFree -and $diskFree -lt 50GB) { $warnings += 'Less than 50 GB free on C:.' }
    if ($virtFw -eq $false) {
        $warnings += 'CPU firmware virtualization looks disabled (WMI). Enable Intel VT-x or AMD-V in UEFI/BIOS, then reboot. Required for Docker Desktop / WSL2.'
    }
    if ($vmMon -eq $false) {
        $warnings += 'Second-level address translation (SLAT) not reported by WMI. Some CPUs need it enabled in BIOS for Hyper-V / Docker.'
    }
    if ($hypervisorPresent -eq $true) {
        $warnings += 'Windows reports a hypervisor (often a VM). Enable nested virtualization for the VM, or install Docker on physical hardware.'
    }

    $details = [ordered]@{
        osCaption                       = $os.Caption
        osBuild                         = $build
        ramBytes                        = $ramBytes
        diskCFreeBytes                  = $diskFree
        ports                           = [pscustomobject]$portChecks
        virtualizationFirmwareEnabled   = $virtFw
        vmMonitorModeExtensions         = $vmMon
        hypervisorPresent               = $hypervisorPresent
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
