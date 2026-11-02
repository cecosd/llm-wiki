# One-step setup for Windows: checks what the library needs, offers to install what is missing, then starts it.
# Nothing is installed without asking (use -Yes to answer yes to everything). Run it with install.cmd (double-click).
#   .\install.ps1              check, install what is missing, start the server
#   .\install.ps1 -NoStart     only prepare, do not start
param([switch]$Yes, [switch]$NoStart)
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Say($t)  { Write-Host "`n$t" -ForegroundColor White }
function Ok($t)   { Write-Host "  [ok] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Ask($q)  { if ($Yes) { return $true }; $a = Read-Host "  $q [Y/n]"; return ($a -eq '' -or $a -match '^[Yy]') }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.local\bin" }
function NodeMajor { if (Have node) { return [int](node -p "process.versions.node.split('.')[0]") } else { return 0 } }

Refresh-Path
Say '1/4  Node.js 20 or newer'
if ((NodeMajor) -ge 20) { Ok "Node.js $(node -v)" }
else {
  Warn 'Node.js 20+ was not found.'
  if ((Have winget) -and (Ask 'Install Node.js (LTS) with winget?')) { winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements; Refresh-Path }
  if ((NodeMajor) -ge 20) { Ok "Node.js $(node -v)" }
  else { Write-Host '  Install Node.js 20+ from https://nodejs.org, open a NEW window and run this again.'; exit 1 }
}

Say '2/4  Libraries (npm install)'
if (Test-Path node_modules\express) { Ok 'already installed' }
else { npm install; if ($LASTEXITCODE -ne 0) { Write-Host '  npm install failed.'; exit 1 }; Ok 'installed' }

Say '3/4  Claude Code'
if (Have claude) { Ok (claude --version | Select-Object -First 1) }
else {
  Warn 'Claude Code was not found. It reads and writes the pages for you.'
  if (Ask 'Install it now with the official installer (https://claude.ai/install.ps1)?') { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression; Refresh-Path }
  if (Have claude) { Ok (claude --version | Select-Object -First 1) } else { Warn 'Not installed. You can still browse the library; install it later from the Setup page.' }
}
if (Have claude) {
  $st = claude auth status 2>$null | Out-String
  if ($st -match '"loggedIn":\s*true') { Ok 'signed in to your Claude account' }
  else {
    Warn 'You are not signed in.'
    Write-Host '  A browser window opens to sign in with a Claude subscription (Pro or Max) or an Anthropic API key.'
    if (Ask 'Sign in now?') { claude auth login }
  }
}

Say '4/4  Optional'
if (Have git) { Ok (git --version) } else { Warn 'git not found: the Undo button will be unavailable. Install: winget install --id Git.Git -e' }

if ($NoStart) { Say 'Ready. Start with: npm run serve'; exit 0 }
Say 'Starting the library at http://localhost:4321  (close this window to stop it)'
Start-Job { Start-Sleep 2; Start-Process 'http://localhost:4321' } | Out-Null
npm run serve
