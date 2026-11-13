# Uninstall for Windows with a window (no black screen). Started by uninstall.cmd.
#   uninstall.cmd                                  opens the window
#   uninstall.cmd -Silent -Yes                     no window: removes shortcuts, the site name, the libraries and the launcher state
#   uninstall.cmd -Silent -Yes -DeleteEverything   also deletes this whole folder, INCLUDING YOUR LIBRARY (raw, wiki, drafts)
#
# By default your library (raw/, wiki/, drafts/, outputs/, settings) is kept. Node.js is never removed, because
# other programs may use it (remove it in Settings -> Apps if you do not need it).
param([switch]$Silent, [switch]$Yes, [switch]$DeleteEverything, [switch]$KeepModules)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bg = (Get-Culture).TwoLetterISOLanguageName -eq 'bg'
function T([string]$en, [string]$bgText) { if ($bg) { return $bgText } else { return $en } }
$script:Sink = { param($line) Write-Host $line }
function Log([string]$m) { & $script:Sink ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Pump { [System.Windows.Forms.Application]::DoEvents() }

function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path -LiteralPath $p) { return $p } }
  return $null
}

# The launcher keeps its lock in %LOCALAPPDATA%\llm-wiki\<first 12 chars of sha256 of the folder path> (see scripts/app.js)
function State-Dir {
  $sha = [Security.Cryptography.SHA256]::Create()
  $h = ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.TrimEnd('\'))) | ForEach-Object { $_.ToString('x2') }) -join ''
  return Join-Path (Join-Path $env:LOCALAPPDATA 'llm-wiki') $h.Substring(0, 12)
}

function Stop-App {
  $state = State-Dir
  $lock = Join-Path $state 'launcher.json'
  if (Test-Path -LiteralPath $lock) {
    try {
      $pid_ = [int]((Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json).pid)
      if (Get-Process -Id $pid_ -ErrorAction SilentlyContinue) {
        Log (T 'Stopping the running library...' 'Спирам работещата библиотека...')
        & taskkill /pid $pid_ /t /f 2>&1 | Out-Null
        Start-Sleep -Milliseconds 800
      }
    } catch { }
  }
}

function Remove-Shortcuts {
  $n = 0
  foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    $lnk = Join-Path $dir 'Biblioteka.lnk'
    if (Test-Path -LiteralPath $lnk) {
      # Remove only our own shortcut: it points at wscript with this folder's launcher
      $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
      if ($s.Arguments -like "*$Root\scripts\launch\Biblioteka.vbs*") { Remove-Item -LiteralPath $lnk -Force; $n++ }
    }
  }
  if ($n -gt 0) { Log ((T 'Removed {0} shortcut(s).' 'Премахнати преки пътища: {0}.') -f $n) } else { Log (T 'No shortcuts of this library found.' 'Няма преки пътища на тази библиотека.') }
}

function Remove-SiteName {
  $node = Find-Node
  if (-not $node -or -not (Test-Path -LiteralPath (Join-Path $Root 'scripts\hosts.js'))) { return }
  $shown = ''
  try { $shown = (& $node (Join-Path $Root 'scripts\hosts.js') show | Select-Object -First 1) } catch { }
  if (-not $shown) { return }
  Log ((T 'Removing the site name {0} from the hosts file (Windows will ask for permission)...' 'Махам името на сайта {0} от файла hosts (Windows ще поиска разрешение)...') -f $shown)
  try {
    Start-Process -FilePath $node -ArgumentList @("`"$Root\scripts\hosts.js`"", 'remove') -Verb RunAs -Wait -WindowStyle Hidden | Out-Null
    $still = (& $node (Join-Path $Root 'scripts\hosts.js') show | Select-Object -First 1)
    if ($still) { Log (T '! The site name is still in the hosts file (permission refused). Remove the block between "# llm-wiki begin" and "# llm-wiki end" by hand.' '! Името на сайта още е във файла hosts (отказано разрешение). Махни ръчно блока между „# llm-wiki begin“ и „# llm-wiki end“.') }
  } catch { Log (T '! The site name was not removed (permission refused).' '! Името на сайта не е махнато (отказано разрешение).') }
}

function Remove-Path([string]$rel, [string]$label) {
  $p = Join-Path $Root $rel
  if (Test-Path -LiteralPath $p) {
    try { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop; Log ((T 'Removed {0}.' 'Премахнато: {0}.') -f $label) }
    catch { Log ((T '! Could not remove {0}: {1}' '! Не можах да премахна {0}: {1}') -f $label, $_.Exception.Message) }
  }
}

function Do-Uninstall([bool]$modules, [bool]$everything) {
  Stop-App
  Remove-Shortcuts
  Remove-SiteName
  $state = State-Dir
  if (Test-Path -LiteralPath $state) { try { Remove-Item -LiteralPath $state -Recurse -Force; Log (T 'Removed the launcher state.' 'Премахнато е състоянието на стартера.') } catch { } }
  $parent = Split-Path -Parent $state
  if ((Test-Path -LiteralPath $parent) -and -not (Get-ChildItem -LiteralPath $parent -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $parent -Force -ErrorAction SilentlyContinue }
  Remove-Path '.launch.json' (T 'the launcher settings' 'настройките на стартера')
  Remove-Path 'scripts\launch\library.ico' (T 'the icon' 'иконата')
  if ($modules -or $everything) { Remove-Path 'node_modules' (T 'the installed libraries (node_modules)' 'инсталираните библиотеки (node_modules)') }
  if ($everything) {
    Log (T 'Deleting the whole library folder after this window closes...' 'Изтривам цялата папка на библиотеката, след като този прозорец се затвори...')
    # The folder cannot delete itself while this script runs from it: a detached cmd waits, then deletes it
    $cmd = "ping -n 4 127.0.0.1 >nul & rmdir /s /q `"$Root`""
    Set-Location -LiteralPath $env:TEMP
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmd) -WindowStyle Hidden
  }
}

# ---------- No window ----------
if ($Silent) {
  if ($DeleteEverything -and -not $Yes) { Write-Host (T 'Deleting everything needs -Yes.' 'Изтриването на всичко иска -Yes.'); exit 2 }
  try { Do-Uninstall (-not $KeepModules) ([bool]$DeleteEverything); Log (T 'Done.' 'Готово.'); exit 0 }
  catch { Log ('ERROR: ' + $_.Exception.Message); exit 1 }
}

# ---------- The window ----------
[System.Windows.Forms.Application]::EnableVisualStyles()
$green = [Drawing.Color]::FromArgb(47, 111, 98)
$form = New-Object Windows.Forms.Form
$form.Text = T 'Biblioteka - uninstall' 'Библиотека - деинсталиране'
$form.ClientSize = New-Object Drawing.Size(660, 480)
$form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false; $form.Font = New-Object Drawing.Font('Segoe UI', 10)
$form.BackColor = [Drawing.Color]::FromArgb(246, 243, 236)

$head = New-Object Windows.Forms.Panel; $head.Dock = 'Top'; $head.Height = 74; $head.BackColor = $green
$title = New-Object Windows.Forms.Label; $title.ForeColor = [Drawing.Color]::White; $title.Font = New-Object Drawing.Font('Segoe UI Semibold', 16); $title.AutoSize = $true; $title.Location = New-Object Drawing.Point(24, 14); $title.Text = T 'Uninstall Biblioteka' 'Деинсталиране на Библиотека'
$sub = New-Object Windows.Forms.Label; $sub.ForeColor = [Drawing.Color]::FromArgb(215, 233, 226); $sub.AutoSize = $true; $sub.Location = New-Object Drawing.Point(26, 46); $sub.Text = T 'Your library is kept unless you choose otherwise' 'Библиотеката ти се запазва, освен ако не избереш друго'
$head.Controls.AddRange(@($title, $sub)); $form.Controls.Add($head)

function New-Label([string]$text, [int]$x, [int]$y, [int]$w, [int]$h) { $l = New-Object Windows.Forms.Label; $l.Text = $text; $l.Location = New-Object Drawing.Point($x, $y); $l.Size = New-Object Drawing.Size($w, $h); return $l }
$form.Controls.Add((New-Label (T "This will always:`n  - stop the library if it is running`n  - remove its shortcuts (desktop and Start menu)`n  - remove the site name from the hosts file, if you set one (Windows asks for permission)`n  - remove the launcher state" "Винаги ще се:`n  - спре библиотеката, ако работи`n  - махнат преките пътища (работен плот и меню Старт)`n  - махне името на сайта от файла hosts, ако си задал такова (Windows иска разрешение)`n  - махне състоянието на стартера") 28 90 610 130))
$chkMod = New-Object Windows.Forms.CheckBox; $chkMod.Checked = $true; $chkMod.Location = New-Object Drawing.Point(30, 230); $chkMod.Size = New-Object Drawing.Size(600, 26)
$chkMod.Text = T 'Remove the installed libraries (node_modules, can be reinstalled)' 'Премахни инсталираните библиотеки (node_modules, могат да се инсталират пак)'
$form.Controls.Add($chkMod)
$chkAll = New-Object Windows.Forms.CheckBox; $chkAll.Checked = $false; $chkAll.Location = New-Object Drawing.Point(30, 262); $chkAll.Size = New-Object Drawing.Size(600, 50)
$chkAll.Text = T 'ALSO delete this whole folder, including my library (sources, wiki pages, drafts, settings). This cannot be undone.' 'ИЗТРИЙ и цялата тази папка, заедно с моята библиотека (източници, страници, чернови, настройки). Не може да се върне.'
$chkAll.ForeColor = [Drawing.Color]::FromArgb(160, 60, 40)
$form.Controls.Add($chkAll)
$form.Controls.Add((New-Label (T 'Tip: before deleting your library, make a backup (Settings -> Backups) or a reading archive. Node.js is not removed.' 'Съвет: преди да изтриеш библиотеката, направи резервно копие (Настройки -> Резервни копия). Node.js не се премахва.') 28 318 610 44))

$logBox = New-Object Windows.Forms.TextBox; $logBox.Multiline = $true; $logBox.ReadOnly = $true; $logBox.ScrollBars = 'Vertical'; $logBox.Location = New-Object Drawing.Point(30, 366); $logBox.Size = New-Object Drawing.Size(600, 58); $logBox.Font = New-Object Drawing.Font('Consolas', 9); $form.Controls.Add($logBox)
$script:Sink = { param($line) $logBox.AppendText($line + "`r`n"); Pump }

$btnGo = New-Object Windows.Forms.Button; $btnGo.Size = New-Object Drawing.Size(140, 32); $btnGo.Location = New-Object Drawing.Point(370, 436); $btnGo.FlatStyle = 'Flat'; $btnGo.BackColor = $green; $btnGo.ForeColor = [Drawing.Color]::White; $btnGo.Text = T 'Uninstall' 'Деинсталирай'
$btnCancel = New-Object Windows.Forms.Button; $btnCancel.Size = New-Object Drawing.Size(110, 32); $btnCancel.Location = New-Object Drawing.Point(520, 436); $btnCancel.Text = T 'Cancel' 'Отказ'
$form.Controls.AddRange(@($btnGo, $btnCancel))
$script:done = $false
$btnCancel.Add_Click({ $form.Close() })
$btnGo.Add_Click({
  if ($script:done) { $form.Close(); return }
  if ($chkAll.Checked) {
    $a = [Windows.Forms.MessageBox]::Show((T "This deletes the folder`n$Root`nincluding ALL your sources, wiki pages and drafts. It cannot be undone.`n`nContinue?" "Това изтрива папката`n$Root`nзаедно с ВСИЧКИ твои източници, страници и чернови. Не може да се върне.`n`nДа продължа ли?"), (T 'Delete everything?' 'Да изтрия ли всичко?'), 'YesNo', 'Warning', 'Button2')
    if ($a -ne 'Yes') { return }
  }
  $btnGo.Enabled = $false; $btnCancel.Enabled = $false; $chkMod.Enabled = $false; $chkAll.Enabled = $false
  try { Do-Uninstall ([bool]$chkMod.Checked) ([bool]$chkAll.Checked); Log (T 'Done. You can close this window.' 'Готово. Можеш да затвориш прозореца.') }
  catch { Log ('ERROR: ' + $_.Exception.Message) }
  $script:done = $true; $btnGo.Text = T 'Close' 'Затвори'; $btnGo.Enabled = $true
})
[void]$form.ShowDialog()
