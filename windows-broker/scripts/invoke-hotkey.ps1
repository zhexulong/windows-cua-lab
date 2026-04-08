# DEPRECATED: legacy SendKeys-based keyboard script retained only as a compatibility reference.
# Primary keyboard execution now runs through the broker-native SendInput path in
# windows-broker/src/DesktopBroker/Win32/KeyboardInjectionService.cs.

param(
  [string]$Keys,
  [string]$TargetApp = ""
)

Add-Type -AssemblyName System.Windows.Forms

function Get-ProcessLookupName {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  return [System.IO.Path]::GetFileNameWithoutExtension($Value)
}

function Activate-TargetApp {
  param([string]$TargetValue)

  $lookupName = Get-ProcessLookupName -Value $TargetValue
  if ([string]::IsNullOrWhiteSpace($lookupName)) {
    return
  }

  $process = Get-Process -Name $lookupName -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1

  if (-not $process) {
    return
  }

  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.AppActivate($process.Id)
  Start-Sleep -Milliseconds 150
}

Activate-TargetApp -TargetValue $TargetApp

$keysToSend = ($Keys -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if (-not $keysToSend) {
  throw "No hotkeys supplied."
}

$modifiers = @()
$normalKeys = @()
foreach ($key in $keysToSend) {
  switch ($key.ToUpperInvariant()) {
    "CTRL" { $modifiers += "^" }
    "SHIFT" { $modifiers += "+" }
    "ALT" { $modifiers += "%" }
    "ESC" { $normalKeys += "{ESC}" }
    "ENTER" { $normalKeys += "{ENTER}" }
    "TAB" { $normalKeys += "{TAB}" }
    "BACKSPACE" { $normalKeys += "{BACKSPACE}" }
    "DEL" { $normalKeys += "{DEL}" }
    "ADD" { $normalKeys += "{ADD}" }
    "SUBTRACT" { $normalKeys += "{SUBTRACT}" }
    default { $normalKeys += $key }
  }
}

$sendKeys = ($modifiers + $normalKeys) -join ""

[System.Windows.Forms.SendKeys]::SendWait($sendKeys)
@{ status = "executed"; keys = $keysToSend } | ConvertTo-Json -Compress
