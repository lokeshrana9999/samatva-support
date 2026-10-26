# Copies the reviewer magic link (<BaseUrl>/join#k=<DEMO_ACCESS_KEY>) to the
# clipboard without showing it. The key comes from .env.local, so it must match
# the DEMO_ACCESS_KEY deployed to the target site.
#   powershell -ExecutionPolicy Bypass -File scripts\magic-link.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\magic-link.ps1 -BaseUrl http://localhost:3000
param(
  [string]$BaseUrl = 'https://samatva-support.vercel.app',
  [string]$File = ''
)

# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside param() defaults,
# so the default path is resolved here instead.
if (-not $File) {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $File = Join-Path $here '..\.env.local'
}
$File = [System.IO.Path]::GetFullPath($File)
if (-not (Test-Path -LiteralPath $File)) { Write-Host "$File doesn't exist. Nothing was copied."; exit 1 }

$line = Get-Content -LiteralPath $File | Where-Object { $_ -match '^DEMO_ACCESS_KEY=' } | Select-Object -Last 1
$key = if ($line) { ($line -replace '^DEMO_ACCESS_KEY=', '').Trim().Trim('"').Trim("'") } else { '' }
if (-not $key) { Write-Host "No DEMO_ACCESS_KEY in $(Split-Path $File -Leaf). Nothing was copied."; exit 1 }

# The key rides in the fragment, never the query string: browsers don't send
# the fragment to the server, so it stays out of request logs.
$url = $BaseUrl.TrimEnd('/') + '/join#k=' + [uri]::EscapeDataString($key)

$copied = $false
for ($i = 0; $i -lt 5 -and -not $copied; $i++) {
  try { Set-Clipboard -Value $url -ErrorAction Stop; $copied = $true } catch { Start-Sleep -Milliseconds 300 }
}
if (-not $copied) { Write-Host "Clipboard is locked. Run this again."; exit 1 }
Write-Host "Copied the magic link for $($BaseUrl.TrimEnd('/')) to the clipboard. It works until DEMO_ACCESS_KEY is rotated."
