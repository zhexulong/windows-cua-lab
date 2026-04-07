param(
  [int]$X,
  [int]$Y,
  [string]$TargetApp = ""
)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
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

[NativeMouse]::SetCursorPos($screenX, $screenY) | Out-Null

@{ status = "executed"; x = $screenX; y = $screenY } | ConvertTo-Json -Compress
