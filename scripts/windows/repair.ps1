param(
    [Parameter(Mandatory)][string]$Code
)

. "$PSScriptRoot\_PrivateAI.Common.ps1"

function Repair-OllamaNotRunning {
    $svcNames = @('Ollama', 'ollama')
    foreach ($n in $svcNames) {
        try {
            $s = Get-Service -Name $n -ErrorAction SilentlyContinue
            if ($null -ne $s -and $s.Status -ne 'Running') {
                Start-Service -Name $n -ErrorAction SilentlyContinue | Out-Null
            }
        }
        catch { }
    }

    $exe = Get-OllamaExecutablePath
    if ($null -ne $exe) {
        Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
    }

    return New-ScriptResult -Ok $true -Status success -Message 'Attempted to start Ollama service/process.' -Details @{ code = 'OLLAMA_NOT_RUNNING' }
}

function Repair-DockerVirtualizationPrereqs {
    $r = Enable-PrivateAIDockerWindowsOptionalFeatures
    if (-not $r.ok) {
        return New-ScriptResult -Ok $false -Status error -Message 'DISM could not enable WSL / Virtual Machine Platform. See details.' -Details @{
            prerequisiteLog = @($r.logLines)
            failedFeature     = $r.failedFeature
            lastExitCode      = $r.lastExitCode
        } -Errors @(
            [pscustomobject]@{ code = 'DOCKER_WINDOWS_PREREQ_DISM_FAILED'; message = 'DISM failed' }
        )
    }
    if ($r.rebootNeeded) {
        return New-ScriptResult -Ok $true -Status warning -Message 'Features enabled. Restart Windows once, then open Docker Desktop or re-run the Install Wizard.' -Details @{
            prerequisiteLog = @($r.logLines)
            rebootRequired    = $true
        } -Warnings @('Restart required (DISM 3010) before virtualization is active. This is expected.')
    }
    return New-ScriptResult -Ok $true -Status success -Message 'WSL and Virtual Machine Platform are enabled (no reboot was required by DISM).' -Details @{ prerequisiteLog = @($r.logLines) }
}

function Repair-DockerProgramDataAcl {
    $r = Repair-DockerProgramDataFolder
    if ($r.action -eq 'skipped') {
        return New-ScriptResult -Ok $true -Status success -Message 'ProgramData\DockerDesktop is not present; nothing to repair.' -Details @{ result = $r }
    }
    if (-not $r.ok) {
        return New-ScriptResult -Ok $false -Status error -Message 'takeown/icacls failed on ProgramData\DockerDesktop. Run this repair from an elevated (admin) session.' -Details @{ result = $r } -Errors @(
            [pscustomobject]@{ code = 'DOCKER_PROGRAMDATA_ACL_FAILED'; message = 'ACL repair failed' }
        )
    }
    return New-ScriptResult -Ok $true -Status success -Message 'Adjusted ownership and ACLs on ProgramData\DockerDesktop. Retry Docker Desktop install or start Docker Desktop.' -Details @{ result = $r }
}

function Repair-DockerNotRunning {
    $dockerPath = "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerPath) {
        Start-Process -FilePath $dockerPath | Out-Null
        return New-ScriptResult -Ok $true -Status success -Message 'Launched Docker Desktop.' -Details @{ code = 'DOCKER_NOT_RUNNING' }
    }
    return New-ScriptResult -Ok $false -Status error -Message 'Docker Desktop executable not found.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'DOCKER_NOT_INSTALLED'; message = 'Docker Desktop not found in Program Files.' }
    )
}

function Repair-OpenWebuiContainer {
    $name = 'privateai-open-webui'
    docker.exe start $name *> $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        return New-ScriptResult -Ok $false -Status warning -Message 'Could not start Open WebUI container automatically. Re-run install-openwebui.ps1.' -Details @{ container = $name } -Errors @(
            [pscustomobject]@{ code = 'OPENWEBUI_CONTAINER_STOPPED'; message = 'docker start failed' }
        )
    }
    return New-ScriptResult -Ok $true -Status success -Message 'Started Open WebUI container.' -Details @{ container = $name }
}

try {
    $result = switch ($Code.ToUpperInvariant()) {
        'OLLAMA_NOT_RUNNING' { Repair-OllamaNotRunning }
        'DOCKER_VIRTUALIZATION_PREREQS' { Repair-DockerVirtualizationPrereqs }
        'DOCKER_PROGRAMDATA_ACL' { Repair-DockerProgramDataAcl }
        'DOCKER_NOT_RUNNING' { Repair-DockerNotRunning }
        'OPENWEBUI_CONTAINER_STOPPED' { Repair-OpenWebuiContainer }
        'OPENWEBUI_CANNOT_REACH_OLLAMA' {
            New-ScriptResult -Ok $true -Status success -Message 'Recreate Open WebUI with OLLAMA_BASE_URL=http://host.docker.internal:11434 (re-run install-openwebui.ps1).' -Details @{
                hint = 'host.docker.internal'
            }
        }
        'COMFYUI_NOT_RUNNING' {
            New-ScriptResult -Ok $false -Status warning -Message 'Start ComfyUI manually with network access enabled on port 8188.' -Details @{} -Errors @(
                [pscustomobject]@{ code = 'COMFYUI_NOT_RUNNING'; message = 'User action required' }
            )
        }
        'PORT_BUSY' {
            $ports = Get-PortsConfig
            New-ScriptResult -Ok $true -Status success -Message 'Port ownership check: review default ports in config/ports.json.' -Details @{
                ports = $ports
            }
        }
        default {
            New-ScriptResult -Ok $false -Status error -Message "Unknown repair code: $Code" -Details @{} -Errors @(
                [pscustomobject]@{ code = 'UNKNOWN_REPAIR_CODE'; message = $Code }
            )
        }
    }

    Write-Output (Write-ScriptJson $result)
    exit 0
}
catch {
    $payload = New-ScriptResult -Ok $false -Status error -Message 'Repair failed.' -Details @{} -Errors @(
        [pscustomobject]@{ code = 'REPAIR_FAILED'; message = $_.Exception.Message }
    )
    Write-Output (Write-ScriptJson $payload)
    exit 1
}
