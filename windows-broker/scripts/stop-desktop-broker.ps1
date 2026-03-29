$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "runtime\desktop-broker.pid"

if (-not (Test-Path $pidFile)) {
  Write-Output "Desktop broker is not running."
  exit 0
}

$pid = Get-Content $pidFile -ErrorAction SilentlyContinue
if ($pid) {
  Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Output "Stopped desktop broker."
