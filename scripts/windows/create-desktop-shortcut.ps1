<#
.SYNOPSIS
  Creates a Desktop shortcut for PrivateAI Launcher with a custom icon.

.DESCRIPTION
  - Ensures resources/branding/app-icon.ico exists (generates a multi-tone logo if missing).
  - Resolves the installed or dev-built PrivateAI Launcher.exe.
  - Writes "PrivateAI Launcher.lnk" on the user's Desktop.
#>
param(
  [string]$ExePath = '',
  [switch]$ForceRegenerateIcon
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  $here = $PSScriptRoot
  return (Resolve-Path -LiteralPath (Join-Path $here '..\..')).Path
}

function Ensure-AppIconIco {
  param([string]$RepoRoot, [bool]$Force)
  $icoDir = Join-Path $RepoRoot 'resources\branding'
  $icoPath = Join-Path $icoDir 'app-icon.ico'
  if (-not $Force -and (Test-Path -LiteralPath $icoPath)) {
    return $icoPath
  }
  if (-not (Test-Path -LiteralPath $icoDir)) {
    New-Item -ItemType Directory -Path $icoDir -Force | Out-Null
  }

  Add-Type -AssemblyName System.Drawing

  $w = 256
  $bmp = New-Object System.Drawing.Bitmap $w, $w
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $w
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 30, 41, 59),
    [System.Drawing.Color]::FromArgb(255, 15, 23, 42),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
  )
  $g.FillRectangle($bg, $rect)
  $bg.Dispose()

  $ringRect = New-Object System.Drawing.Rectangle 24, 24, 208, 208
  $accent = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $ringRect,
    [System.Drawing.Color]::FromArgb(255, 99, 102, 241),
    [System.Drawing.Color]::FromArgb(255, 34, 211, 153),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
  )
  $ringPen = New-Object System.Drawing.Pen($accent, 14)
  $g.DrawEllipse($ringPen, 28, 28, 200, 200)
  $ringPen.Dispose()
  $accent.Dispose()

  $nodeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 45, 212, 191))
  $g.FillEllipse($nodeBrush, 72, 64, 40, 40)
  $g.FillEllipse($nodeBrush, 168, 96, 40, 40)
  $g.FillEllipse($nodeBrush, 96, 168, 40, 40)
  $node2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 167, 139, 250))
  $g.FillEllipse($node2, 176, 168, 36, 36)
  $nodeBrush.Dispose()
  $node2.Dispose()

  $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 226, 232, 240), 6)
  $g.DrawLine($linePen, 92, 84, 188, 116)
  $g.DrawLine($linePen, 188, 116, 116, 188)
  $g.DrawLine($linePen, 116, 188, 194, 186)
  $linePen.Dispose()

  # Simple padlock (privacy): arc shackle + body
  $wPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(240, 248, 250, 252), 12)
  $wPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $wPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($wPen, 98, 112, 60, 52, 180, 180)
  $wPen.Dispose()
  $bodyBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(238, 248, 250, 252))
  [void]$g.FillRectangle($bodyBrush, 112, 168, 72, 56)
  $bodyBrush.Dispose()

  $g.Dispose()

  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  try {
    $fs = [System.IO.File]::Create($icoPath)
    try {
      $icon.Save($fs)
    }
    finally {
      $fs.Dispose()
    }
  }
  finally {
    $icon.Dispose()
    $bmp.Dispose()
  }

  return $icoPath
}

function Resolve-LauncherExe {
  param([string]$Explicit)
  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    if (-not (Test-Path -LiteralPath $Explicit)) {
      throw "ExePath not found: $Explicit"
    }
    return (Resolve-Path -LiteralPath $Explicit).Path
  }

  $candidates = @(
    "${env:ProgramFiles}\PrivateAI Launcher\PrivateAI Launcher.exe",
    "${env:ProgramFiles(x86)}\PrivateAI Launcher\PrivateAI Launcher.exe",
    "${env:LOCALAPPDATA}\Programs\PrivateAI Launcher\PrivateAI Launcher.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path -LiteralPath $p) {
      return (Resolve-Path -LiteralPath $p).Path
    }
  }

  $repo = Get-RepoRoot
  $dev = @(
    (Join-Path $repo 'installer-out\win-unpacked\PrivateAI Launcher.exe'),
    (Join-Path $repo 'release\win-unpacked\PrivateAI Launcher.exe')
  )
  foreach ($p in $dev) {
    if (Test-Path -LiteralPath $p) {
      return (Resolve-Path -LiteralPath $p).Path
    }
  }

  throw @"
Could not find PrivateAI Launcher.exe.
Install the app (NSIS) or build with npm run dist:win / dist:win:clean, then either:
  - Re-run this script, or
  - Pass -ExePath 'C:\full\path\to\PrivateAI Launcher.exe'
"@
}

$repoRoot = Get-RepoRoot
$iconPath = Ensure-AppIconIco -RepoRoot $repoRoot -Force:$ForceRegenerateIcon
$exe = Resolve-LauncherExe -Explicit $ExePath

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'PrivateAI Launcher.lnk'
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = Split-Path -Parent $exe
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'PrivateAI Launcher — local Ollama, Open WebUI, and ComfyUI'
$shortcut.Save()

Write-Host "Desktop shortcut created:"
Write-Host "  $lnkPath"
Write-Host "Target: $exe"
Write-Host "Icon:   $iconPath"
