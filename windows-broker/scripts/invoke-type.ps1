param(
  [string]$Text
)

Add-Type -AssemblyName System.Windows.Forms

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
