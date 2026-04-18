param(
  [string]$ListenHost = "127.0.0.1",
  [int]$Port = 10578,
  [string]$ApiKey = ""
)

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "src\DesktopBroker\DesktopBroker.csproj"
$runtimeDir = Join-Path $root "runtime"
$pidFile = Join-Path $runtimeDir "desktop-broker.pid"
$stdoutLog = Join-Path $runtimeDir "desktop-broker.stdout.log"
$stderrLog = Join-Path $runtimeDir "desktop-broker.stderr.log"
$stageDir = Join-Path $env:TEMP "windows-cua-lab-desktop-broker"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Test-BrokerHealth {
  param([int]$Port)

  try {
    Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/health" | Out-Null
    return $true
  }
  catch {
    return $false
  }
}

if (Test-Path $pidFile) {
  $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($existingPid) {
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existingProcess -and (Test-BrokerHealth -Port $Port)) {
      Write-Output "Desktop broker already running with PID $existingPid"
      exit 0
    }

    if ($existingProcess) {
      Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 300
    }
  }
}

dotnet build $project | Out-Null

$buildOutput = Join-Path $root "src\DesktopBroker\bin\Debug\net8.0-windows"
Remove-Item $stageDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $stdoutLog -Force -ErrorAction SilentlyContinue
Remove-Item $stderrLog -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Copy-Item -Path (Join-Path $buildOutput "*") -Destination $stageDir -Recurse -Force
$stageScriptsDir = Join-Path $stageDir "scripts"
New-Item -ItemType Directory -Force -Path $stageScriptsDir | Out-Null
Copy-Item -Path (Join-Path $root "scripts\*") -Destination $stageScriptsDir -Recurse -Force

$brokerDll = Join-Path $stageDir "DesktopBroker.dll"
$arguments = @($brokerDll, "--host", $ListenHost, "--port", $Port, "--script-root", $stageScriptsDir)

if ($ApiKey) {
  $arguments += @("--api-key", $ApiKey)
}

$process = Start-Process -FilePath "dotnet" -WorkingDirectory $stageDir -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
Set-Content -Path $pidFile -Value $process.Id
Write-Output "Started desktop broker on port $Port with PID $($process.Id)"
