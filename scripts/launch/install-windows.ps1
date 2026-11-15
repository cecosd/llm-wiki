param(
  [string]$Distro,
  [string]$Dir,
  [string]$WikiHost = 'my.wiki',
  [int]$Port = 4321,
  [string]$Result
)
$ErrorActionPreference = 'Stop'
$out = @()
try {
  # 1) hosts: 127.0.0.1 my.wiki
  $hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
  $content = Get-Content $hosts -Raw
  $pattern = '(?m)^\s*127\.0\.0\.1\s+' + [regex]::Escape($WikiHost) + '\s*$'
  if ($content -notmatch $pattern) {
    Add-Content -Path $hosts -Value ("`r`n127.0.0.1 " + $WikiHost)
    $out += "HOSTS=added"
  } else { $out += "HOSTS=already" }
  ipconfig /flushdns | Out-Null

  # 2) port 80 -> the port of the library (only if it is free or the rule is already ours)
  $rules = (netsh interface portproxy show v4tov4) -join "`n"
  $has = $rules -match ('127\.0\.0\.1\s+80\s+127\.0\.0\.1\s+' + $Port)
  $busy = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue
  if ($has) { $p80 = 'yes' }
  elseif ($busy) { $p80 = 'no' }
  else {
    netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=80 connectaddress=127.0.0.1 connectport=$Port | Out-Null
    $p80 = 'yes'
  }
  $out += "PORT80=$p80"

  # 3) a shortcut on the desktop (not fatal if it fails: hosts and the port are already ready)
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if (-not (Test-Path $desktop)) { $desktop = Join-Path $env:USERPROFILE 'OneDrive\Desktop' }
    if (-not (Test-Path $desktop)) { $desktop = Join-Path $env:USERPROFILE 'Desktop' }
    # It is first created in TEMP with a Latin name (COM sometimes breaks with Cyrillic and with folders under OneDrive), then copied
    $tmpLnk = Join-Path $env:TEMP 'Biblioteka.lnk'
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($tmpLnk)
    $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wsl.exe'
    $lnk.Arguments = "-d $Distro --cd `"$Dir`" -e bash scripts/launch/wsl-start.sh"
    $lnk.WindowStyle = 7
    $lnk.Description = 'Biblioteka'
    $lnk.Save()
    try { Copy-Item $tmpLnk (Join-Path $desktop ([string]::Concat([char]0x0411,[char]0x0438,[char]0x0431,[char]0x043B,[char]0x0438,[char]0x043E,[char]0x0442,[char]0x0435,[char]0x043A,[char]0x0430,'.lnk'))) -Force; $out += "SHORTCUT=ok" }
    catch { Copy-Item $tmpLnk (Join-Path $desktop 'Biblioteka.lnk') -Force; $out += "SHORTCUT=ok (Biblioteka.lnk)" }
  } catch {
    $out += ("SHORTCUT=failed " + $_.Exception.Message)
  }
  $out += "STATUS=ok"
} catch {
  $out += ("STATUS=error " + $_.Exception.Message)
}
$out | Set-Content -Path $Result -Encoding ASCII
