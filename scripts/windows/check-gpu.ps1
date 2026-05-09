. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Get-GpuFromSmi {
    try {
        # Prefer numeric MiB via nounits (avoids comma issues in localized CSV text).
        $rawUnits = & nvidia-smi.exe --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null
        $line = ($rawUnits -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)

        if (-not [string]::IsNullOrWhiteSpace($line)) {
            $parts = $line.Split(',') | ForEach-Object { $_.Trim() }
            if ($parts.Count -ge 3) {
                $memNum = $null
                try { $memNum = [int64]$parts[1] } catch { }

                return [pscustomobject]@{
                    name       = [string]$parts[0]
                    vramMb     = $memNum          # MiB when nounits is used
                    driver     = [string]$parts[2]
                    source     = 'nvidia-smi'
                }
            }
        }

        # Fallback: human-readable units (MiB/GiB in text).
        $raw = & nvidia-smi.exe --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>$null
        if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

        $line2 = ($raw -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
        if ([string]::IsNullOrWhiteSpace($line2)) { return $null }

        $parts = $line2.Split(',') | ForEach-Object { $_.Trim() }
        if ($parts.Count -lt 3) { return $null }

        $name = [string]$parts[0]
        $mem = [string]$parts[1]
        $driver = [string]$parts[2]

        $vramMb = $null
        if ($mem -match '([\d\.]+)\s*GiB') {
            $vramMb = [int64][math]::Round([double]$Matches[1] * 1024)
        }
        elseif ($mem -match '(\d+)\s*MiB') {
            $vramMb = [int64]$Matches[1]
        }
        elseif ($mem -match '(\d+)\s*MB') {
            $vramMb = [int64]$Matches[1]
        }

        return [pscustomobject]@{
            name       = $name
            vramMb     = $vramMb
            driver     = $driver
            source     = 'nvidia-smi'
        }
    }
    catch {
        return $null
    }
}

function Get-GpuFromWmi {
    try {
        $vc = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1
        if ($null -eq $vc) { return $null }

        $vramBytes = $null
        try { $vramBytes = [int64]$vc.AdapterRAM } catch { }

        $vramMb = $null
        if ($null -ne $vramBytes -and $vramBytes -gt 0) { $vramMb = [int64]([math]::Round($vramBytes / 1MB)) }

        return [pscustomobject]@{
            name   = [string]$vc.Name
            vramMb = $vramMb
            driver = [string]$vc.DriverVersion
            source = 'wmi'
        }
    }
    catch {
        return $null
    }
}

function Get-ReadinessTier {
    param(
        [bool]$NvidiaPresent,
        [Nullable[int64]]$VramMb
    )

    if (-not $NvidiaPresent) {
        return [pscustomobject]@{
            readiness       = 'unsupported'
            readinessLabel  = 'Unsupported: no NVIDIA GPU detected.'
        }
    }

    if ($null -eq $VramMb -or $VramMb -le 0) {
        return [pscustomobject]@{
            readiness       = 'basic'
            readinessLabel  = 'Basic: NVIDIA GPU detected, but VRAM could not be read reliably.'
        }
    }

    if ($VramMb -lt 6144) {
        return [pscustomobject]@{
            readiness       = 'basic'
            readinessLabel  = 'Basic: chat OK; image generation may be limited.'
        }
    }

    if ($VramMb -lt 10240) {
        return [pscustomobject]@{
            readiness       = 'recommended'
            readinessLabel  = 'Recommended: good balance for chat and image workflows.'
        }
    }

    if ($VramMb -lt 16384) {
        return [pscustomobject]@{
            readiness       = 'creator'
            readinessLabel  = 'Creator: higher quality image workflows are realistic.'
        }
    }

    return [pscustomobject]@{
        readiness       = 'pro'
        readinessLabel  = 'Pro: heavy workflows are realistic.'
    }
}

try {
    $gpu = Get-GpuFromSmi
    if ($null -eq $gpu) { $gpu = Get-GpuFromWmi }

    $nvidiaPresent = $null -ne $gpu
    $tier = Get-ReadinessTier -NvidiaPresent $nvidiaPresent -VramMb $(if ($null -eq $gpu) { $null } else { $gpu.vramMb })

    $vramGbDisplay = $null
    if ($null -ne $gpu -and $null -ne $gpu.vramMb -and $gpu.vramMb -gt 0) {
        $vramGbDisplay = [math]::Round(([double]$gpu.vramMb / 1024), 1)
    }

    $details = [ordered]@{
        nvidiaPresent = [bool]$nvidiaPresent
        gpuName       = $(if ($null -eq $gpu) { $null } else { $gpu.name })
        vramMb        = $(if ($null -eq $gpu) { $null } else { $gpu.vramMb })
        vramGb        = $vramGbDisplay           # rounded for UI; null if unknown
        driverVersion = $(if ($null -eq $gpu) { $null } else { $gpu.driver })
        detection     = $(if ($null -eq $gpu) { $null } else { $gpu.source })
        readiness     = [string]$tier.readiness
        readinessLabel = [string]$tier.readinessLabel
    }

    if (-not $nvidiaPresent) {
        $payload = New-ScriptResult -Ok $false -Status error -Message 'No NVIDIA GPU detected.' -Details ([pscustomobject]$details) -Errors @(
            [pscustomobject]@{ code = 'NVIDIA_NOT_FOUND'; message = 'No NVIDIA GPU was detected by nvidia-smi or WMI.' }
        )
        Write-Output (Write-ScriptJson $payload)
        exit 1
    }

    $payload = New-ScriptResult -Ok $true -Status success -Message 'GPU scan complete.' -Details ([pscustomobject]$details)
    Write-Output (Write-ScriptJson $payload)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'GPU scan failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'GPU_SCAN_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
