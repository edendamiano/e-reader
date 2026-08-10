$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$notices = Join-Path $repo "THIRD_PARTY_NOTICES.txt"

foreach ($required in @($notices)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Missing release prerequisite: $required"
  }
}

Push-Location $repo
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Application build failed." }
  npx electron-builder --win nsis --x64
  if ($LASTEXITCODE -ne 0) { throw "Windows installer build failed." }
}
finally {
  Pop-Location
}
