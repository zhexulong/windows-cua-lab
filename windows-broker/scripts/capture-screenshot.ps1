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

$bounds = if ($Scope -eq "window") {
  Get-TargetWindowRectangle -TargetValue $Target
} else {
  $null
}

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
}

$memory.Dispose()
$payload | ConvertTo-Json -Compress
