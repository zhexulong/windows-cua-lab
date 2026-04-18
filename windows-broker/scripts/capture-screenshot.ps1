param(
  [string]$Scope = "window",
  [string]$Target = ""
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeDisplay {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

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

function Get-PrimaryScreenRectangle {
  return [System.Windows.Forms.SystemInformation]::VirtualScreen
}

function Get-TargetWindowRectangle {
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

  $rect = New-Object NativeDisplay+RECT
  if (-not [NativeDisplay]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) {
    return $null
  }

  return [System.Drawing.Rectangle]::FromLTRB($rect.Left, $rect.Top, $rect.Right, $rect.Bottom)
}

function Get-ForegroundWindowMetadata {
  $handle = [NativeDisplay]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) {
    return @{
      processName = ""
      windowTitle = ""
    }
  }

  $builder = New-Object System.Text.StringBuilder 1024
  [void][NativeDisplay]::GetWindowText($handle, $builder, $builder.Capacity)

  [uint32]$processId = 0
  [void][NativeDisplay]::GetWindowThreadProcessId($handle, [ref]$processId)

  $processName = ""
  if ($processId -ne 0) {
    try {
      $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
    } catch {
      $processName = ""
    }
  }

  return @{
    processName = $processName
    windowTitle = $builder.ToString()
  }
}

$targetBounds = $null
$targetResolved = $false
$scopeUsed = "screen"

if ($Scope -eq "window") {
  $targetBounds = Get-TargetWindowRectangle -TargetValue $Target
  if ($targetBounds) {
    $targetResolved = $true
    $scopeUsed = "window"
  }
}

$bounds = $targetBounds

if (-not $bounds) {
  $bounds = Get-PrimaryScreenRectangle
}

$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$memory = New-Object System.IO.MemoryStream
$bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

$payload = @{
  ref = "broker/screenshot-$(Get-Date -Format 'yyyyMMddHHmmssfff').png"
  base64 = [System.Convert]::ToBase64String($memory.ToArray())
  targetResolved = $targetResolved
  scopeUsed = $scopeUsed
}

$foreground = Get-ForegroundWindowMetadata
$payload.actualProcessName = $foreground.processName
$payload.actualWindowTitle = $foreground.windowTitle

$memory.Dispose()
$payload | ConvertTo-Json -Compress
