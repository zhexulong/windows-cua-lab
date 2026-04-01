param(
  [string]$Endpoint = "http://127.0.0.1:10578",
  [string]$ApiKey = ""
)

$headers = @{}
if ($ApiKey) {
  $headers["Authorization"] = "Bearer $ApiKey"
}

$health = Invoke-RestMethod -Method Get -Uri "$Endpoint/health" -Headers $headers
$health | ConvertTo-Json -Depth 5

$body = @{
  requestId = "test-screenshot"
  sessionId = "broker-test"
  action = @{
    kind = "screenshot"
    scope = "desktop"
    target = "mspaint.exe"
  }
  policyContext = @{
    allowedRoots = @("E:\projects\desktop-discovery-lab-temp")
    blockedCapabilities = @("arbitrary_shell", "registry_mutation", "process_kill")
    operator = "broker-test"
    requiresHumanReview = $false
  }
  expectedState = @{
    targetApp = "mspaint.exe"
  }
} | ConvertTo-Json -Depth 8

$response = Invoke-RestMethod -Method Post -Uri "$Endpoint/v1/action" -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body $body
$response | ConvertTo-Json -Depth 8
