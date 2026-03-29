param(
  [string]$Keys
)

Add-Type -AssemblyName System.Windows.Forms

$keysToSend = ($Keys -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if (-not $keysToSend) {
  throw "No hotkeys supplied."
}

$sendKeys = ($keysToSend | ForEach-Object {
  switch ($_) {
    "CTRL" { "^" }
    "SHIFT" { "+" }
    "ALT" { "%" }
    default { $_ }
  }
}) -join ""

[System.Windows.Forms.SendKeys]::SendWait($sendKeys)
@{ status = "executed"; keys = $keysToSend } | ConvertTo-Json -Compress
