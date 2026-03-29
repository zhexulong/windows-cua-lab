param(
  [int]$FromX,
  [int]$FromY,
  [int]$ToX,
  [int]$ToY
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

[NativeMouse]::SetCursorPos($FromX, $FromY) | Out-Null
Start-Sleep -Milliseconds 50
[NativeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)

$steps = 20
for ($index = 1; $index -le $steps; $index++) {
  $x = [int]($FromX + (($ToX - $FromX) * $index / $steps))
  $y = [int]($FromY + (($ToY - $FromY) * $index / $steps))
  [NativeMouse]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 15
}

[NativeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)

@{ status = "executed"; from = @{ x = $FromX; y = $FromY }; to = @{ x = $ToX; y = $ToY } } | ConvertTo-Json -Compress
