param(
  [string]$Endpoint = "http://127.0.0.1:10578",
  [string]$ApiKey = "",
  [int]$BrokerPid = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeForegroundGrant
{
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AllowSetForegroundWindow(int dwProcessId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

function Get-ForegroundSnapshot {
  $handle = [NativeForegroundGrant]::GetForegroundWindow()
  $titleBuilder = New-Object System.Text.StringBuilder 1024
  $foregroundPid = 0
  $foregroundProcessName = ""
  $foregroundWindowTitle = ""

  if ($handle -ne [IntPtr]::Zero) {
    [void][NativeForegroundGrant]::GetWindowThreadProcessId($handle, [ref]$foregroundPid)
    [void][NativeForegroundGrant]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
    $foregroundWindowTitle = $titleBuilder.ToString()

    if ($foregroundPid -ne 0) {
      try {
        $foregroundProcessName = (Get-Process -Id $foregroundPid -ErrorAction Stop).ProcessName
      }
      catch {
        $foregroundProcessName = ""
      }
    }
  }

  return [pscustomobject]@{
    foregroundPid = $foregroundPid
    foregroundProcessName = $foregroundProcessName
    foregroundWindowTitle = $foregroundWindowTitle
  }
}

if ($BrokerPid -le 0) {
  $headers = @{}
  if ($ApiKey) {
    $headers["Authorization"] = "Bearer $ApiKey"
  }

  $health = Invoke-RestMethod -Method Get -Uri "$Endpoint/health" -Headers $headers
  if (-not $health.processId) {
    throw "Broker health payload did not include processId."
  }

  $BrokerPid = [int]$health.processId
}

$before = Get-ForegroundSnapshot
$grantSucceeded = [NativeForegroundGrant]::AllowSetForegroundWindow($BrokerPid)
$grantLastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
$after = Get-ForegroundSnapshot

[pscustomobject]@{
  endpoint = $Endpoint
  brokerPid = $BrokerPid
  grantAttempted = $true
  grantSucceeded = $grantSucceeded
  grantLastError = $grantLastError
  foregroundPid = $before.foregroundPid
  foregroundProcessName = $before.foregroundProcessName
  foregroundWindowTitle = $before.foregroundWindowTitle
  foregroundPidAfter = $after.foregroundPid
  foregroundProcessNameAfter = $after.foregroundProcessName
  foregroundWindowTitleAfter = $after.foregroundWindowTitle
} | ConvertTo-Json -Depth 5 -Compress
