# Syntax-check every .ps1 under scripts/windows (no execution).
Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$failed = 0
Get-ChildItem -LiteralPath $root -Filter '*.ps1' -File -ErrorAction Stop | Sort-Object Name | ForEach-Object {
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errs)
    if ($errs.Count -gt 0) {
        Write-Host "FAIL $($_.Name)"
        $errs | ForEach-Object { Write-Host "  $($_.Message)" }
        $failed++
    }
    else {
        Write-Host "OK   $($_.Name)"
    }
}
if ($failed -gt 0) { exit 1 }
exit 0
