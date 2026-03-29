param(
  [string]$Keys
)

Add-Type -AssemblyName System.Windows.Forms

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
