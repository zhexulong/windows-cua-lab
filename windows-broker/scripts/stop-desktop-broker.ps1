$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "runtime"
$pidFile = Join-Path $runtimeDir "desktop-broker.pid"

if (-not (Test-Path $pidFile)) {
  Write-Output "Desktop broker is not running."
  exit 0
}

$brokerPid = Get-Content $pidFile -ErrorAction SilentlyContinue
if ($brokerPid) {
  Stop-Process -Id $brokerPid -Force -ErrorAction SilentlyContinue
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Output "Stopped desktop broker."
