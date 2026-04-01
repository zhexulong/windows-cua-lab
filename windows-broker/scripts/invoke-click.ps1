param(
  [int]$X,
  [int]$Y,
  [string]$Button = "left",
  [string]$TargetApp = ""
)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}

public static class NativeDisplay {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
"@

[NativeDisplay]::SetProcessDPIAware() | Out-Null

function Get-ProcessLookupName {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  return [System.IO.Path]::GetFileNameWithoutExtension($Value)
}

function Get-TargetWindowRect {
  param([string]$TargetValue)

  $lookupName = Get-ProcessLookupName -Value $TargetValue
  if ([string]::IsNullOrWhiteSpace($lookupName)) {
    return $null
  }

  $process = Get-Process -Name $lookupName -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1

  if (-not $process) {
    return $null
  }

  $windowRect = New-Object NativeDisplay+RECT
  if (-not [NativeDisplay]::GetWindowRect($process.MainWindowHandle, [ref]$windowRect)) {
    return $null
  }

  return $windowRect
}

$screenX = $X
$screenY = $Y

$windowRect = Get-TargetWindowRect -TargetValue $TargetApp
if ($windowRect) {
  $screenX = $windowRect.Left + $X
  $screenY = $windowRect.Top + $Y
}

$flagsDown = if ($Button -eq "right") { 0x0008 } else { 0x0002 }
$flagsUp = if ($Button -eq "right") { 0x0010 } else { 0x0004 }

[NativeMouse]::SetCursorPos($screenX, $screenY) | Out-Null
Start-Sleep -Milliseconds 50
[NativeMouse]::mouse_event($flagsDown, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[NativeMouse]::mouse_event($flagsUp, 0, 0, 0, [UIntPtr]::Zero)

@{ status = "executed"; x = $screenX; y = $screenY; button = $Button } | ConvertTo-Json -Compress
