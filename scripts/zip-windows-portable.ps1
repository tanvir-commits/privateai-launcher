#Requires -Version 5.1
# After npm run dist:win, zips release/win-unpacked into release/PrivateAI-Launcher-VERSION-windows-portable.zip
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$pkg = Get-Content -Raw package.json | ConvertFrom-Json
$ver = [string]$pkg.version
$src = Join-Path (Get-Location) 'release\win-unpacked'
if (-not (Test-Path -LiteralPath $src)) {
  Write-Error "Missing $src - run npm run dist:win first."
}
$folderName = "PrivateAI-Launcher-$ver-windows-portable"
$release = Join-Path (Get-Location) 'release'
$zip = Join-Path $release "$folderName.zip"
if (Test-Path -LiteralPath $zip) {
  Remove-Item -LiteralPath $zip -Force -ErrorAction Stop
}
# Stage in TEMP so a previous failed run under release/ cannot lock app.asar cleanup.
$stageRoot = Join-Path $env:TEMP ("privateai-portable-" + $ver + '-' + [Guid]::NewGuid().ToString('n'))
$stage = Join-Path $stageRoot $folderName
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
  $null = robocopy $src $stage /E /COPY:DAT /R:2 /W:2 /NFL /NDL /NJH /NJS
  if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy failed with exit code $LASTEXITCODE"
  }
  Push-Location $stageRoot
  try {
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($null -ne $tar) {
      & tar.exe -a -c -f $zip $folderName
      if ($LASTEXITCODE -ne 0) {
        Write-Error "tar.exe failed with exit code $LASTEXITCODE"
      }
    }
    else {
      Compress-Archive -Path $folderName -DestinationPath $zip -CompressionLevel Optimal -Force
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ('Wrote: ' + $zip)
