# DEPRECATED: legacy SendKeys-based typing script retained only as a compatibility reference.
# Primary keyboard execution now runs through the broker-native SendInput path in
# windows-broker/src/DesktopBroker/Win32/KeyboardInjectionService.cs.

param(
  [string]$Text,
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

function Convert-ToSendKeysLiteral {
  param([string]$Value)

  $builder = New-Object System.Text.StringBuilder
  foreach ($char in $Value.ToCharArray()) {
    switch ($char) {
      '+' { [void]$builder.Append('{ADD}') }
      '^' { [void]$builder.Append('{^}') }
      '%' { [void]$builder.Append('{%}') }
      '~' { [void]$builder.Append('{~}') }
      '-' { [void]$builder.Append('{SUBTRACT}') }
      '(' { [void]$builder.Append('{(}') }
      ')' { [void]$builder.Append('{)}') }
      '{' { [void]$builder.Append('{{}') }
      '}' { [void]$builder.Append('{}}') }
      default { [void]$builder.Append($char) }
    }
  }

  return $builder.ToString()
}

$literal = Convert-ToSendKeysLiteral -Value $Text
[System.Windows.Forms.SendKeys]::SendWait($literal)
@{ status = "executed"; textLength = $Text.Length } | ConvertTo-Json -Compress
