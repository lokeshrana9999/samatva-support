# Moves a secret from the clipboard into .env.local without showing it.
# Copy the key on the provider's page first, then run:
#   powershell -ExecutionPolicy Bypass -File scripts\secret-from-clipboard.ps1 -Name TYPESAFE_API_KEY -Pattern '^\S{20,}$'
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Pattern = '^\S{16,}$',
  [string]$File = (Join-Path $PSScriptRoot '..\.env.local')
)

$value = $null
for ($i = 0; $i -lt 5 -and -not $value; $i++) {
  try { $value = (Get-Clipboard -Raw -ErrorAction Stop) } catch { Start-Sleep -Milliseconds 300 }
}
if (-not $value) { Write-Host "Clipboard is empty or locked. Copy the key and run this again."; exit 1 }
$value = $value.Trim()
if ($value -notmatch $Pattern) { Write-Host "The clipboard doesn't look like a $Name. Nothing was written."; exit 1 }

$lines = @()
if (Test-Path $File) { $lines = @(Get-Content $File | Where-Object { $_ -notmatch "^$([regex]::Escape($Name))=" }) }
$lines += "$Name=$value"
# UTF-8 without a BOM, so dotenv parsers read the first line cleanly.
[System.IO.File]::WriteAllLines((Resolve-Path -LiteralPath (Split-Path $File) | Join-Path -ChildPath (Split-Path $File -Leaf)), $lines, (New-Object System.Text.UTF8Encoding($false)))

Set-Clipboard -Value ' '
Write-Host "Saved $Name to $(Split-Path $File -Leaf) ($($value.Length) characters). Clipboard cleared."
