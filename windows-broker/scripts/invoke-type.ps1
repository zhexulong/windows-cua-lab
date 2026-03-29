param(
  [string]$Text
)

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($Text)
@{ status = "executed"; textLength = $Text.Length } | ConvertTo-Json -Compress
