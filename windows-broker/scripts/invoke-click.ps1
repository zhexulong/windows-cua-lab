param(
  [int]$X,
  [int]$Y,
  [string]$Button = "left"
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$flagsDown = if ($Button -eq "right") { 0x0008 } else { 0x0002 }
$flagsUp = if ($Button -eq "right") { 0x0010 } else { 0x0004 }

[NativeMouse]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 50
[NativeMouse]::mouse_event($flagsDown, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[NativeMouse]::mouse_event($flagsUp, 0, 0, 0, [UIntPtr]::Zero)

@{ status = "executed"; x = $X; y = $Y; button = $Button } | ConvertTo-Json -Compress
