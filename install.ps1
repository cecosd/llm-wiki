# Setup for Windows with a window (no black screen). Started by install.cmd.
#   install.cmd                          opens the setup window
#   install.cmd -Silent -Yes -NoStart    no window: prints to the console (for scripts)
#   options: -SiteName biblioteka.test   -NoShortcuts   -NoStart
#
# What it does: (1) installs the latest Node.js if it is missing or older than 24, (2) installs the program's libraries,
# (3) optionally writes a name for the local site into the hosts file, (4) makes shortcuts.
# It installs NO AI: the model (Claude, another provider, a local model or manual) is chosen later inside the app.
param([switch]$Silent, [switch]$Yes, [switch]$NoStart, [string]$SiteName = '', [switch]$NoShortcuts)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$bg = (Get-Culture).TwoLetterISOLanguageName -eq 'bg'
function T([string]$en, [string]$bgText) { if ($bg) { return $bgText } else { return $en } }

$null = New-Item -ItemType Directory -Force -Path (Join-Path $Root 'outputs')
$LogFile = Join-Path $Root 'outputs\install.log'
$script:Sink = { param($line) Write-Host $line }
function Log([string]$m) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m
  try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 } catch { }
  & $script:Sink $line
}
function Pump { [System.Windows.Forms.Application]::DoEvents() }

# ---------- Node.js ----------
function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$m;$u"
}
function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path -LiteralPath $p) { return $p } }
  return $null
}
function Node-Major {
  $n = Find-Node
  if (-not $n) { return 0 }
  try { return [int](& $n -p "process.versions.node.split('.')[0]" | Select-Object -First 1) } catch { return 0 }
}
function Download([string]$url, [string]$out) {
  $wc = New-Object Net.WebClient
  try {
    $t = $wc.DownloadFileTaskAsync($url, $out)
    while (-not $t.IsCompleted) { Pump; Start-Sleep -Milliseconds 80 }
    if ($t.IsFaulted) { throw $t.Exception.InnerException }
  } finally { $wc.Dispose() }
}
function Install-Node {
  Log (T 'Looking for the latest Node.js release...' 'Търся последната версия на Node.js...')
  $wc = New-Object Net.WebClient
  $idx = $wc.DownloadString('https://nodejs.org/dist/index.json') | ConvertFrom-Json
  $wc.Dispose()
  $latest = $idx[0].version
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $file = "node-$latest-$arch.msi"
  $tmp = Join-Path $env:TEMP $file
  Log ((T 'Downloading Node.js {0} (about 30 MB)...' 'Свалям Node.js {0} (около 30 MB)...') -f $latest)
  Download "https://nodejs.org/dist/$latest/$file" $tmp
  # Check the file against the checksums that nodejs.org publishes
  $wc = New-Object Net.WebClient
  $sums = $wc.DownloadString("https://nodejs.org/dist/$latest/SHASUMS256.txt")
  $wc.Dispose()
  $line = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($file) } | Select-Object -First 1)
  $want = if ($line) { ($line.Trim() -split '\s+')[0].ToLower() } else { '' }
  $got = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower()
  if (-not $want -or $want -ne $got) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; throw (T 'The downloaded Node.js file did not match its published checksum, so it was not installed.' 'Свалената Node.js не съвпада с публикуваната контролна сума и не е инсталирана.') }
  Log (T 'Installing Node.js. Windows may ask for permission: please allow it.' 'Инсталирам Node.js. Windows може да поиска разрешение: позволи го.')
  $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$tmp`"", '/passive', '/norestart') -Verb RunAs -Wait -PassThru
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw ((T 'The Node.js installer stopped with code {0}.' 'Инсталаторът на Node.js спря с код {0}.') -f $p.ExitCode) }
  Refresh-Path
}

# ---------- Running a command with its output in the log ----------
function Run-Logged([string]$cmdline) {
  $out = Join-Path $env:TEMP ('llm-wiki-' + [guid]::NewGuid().ToString('N') + '.log')
  $psi = New-Object Diagnostics.ProcessStartInfo('cmd.exe', "/s /c `"$cmdline > `"$out`" 2>&1`"")
  $psi.WorkingDirectory = $Root; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $p = [Diagnostics.Process]::Start($psi)
  $script:seen = 0
  $tail = {
    try {
      $fs = [IO.File]::Open($out, 'Open', 'Read', 'ReadWrite'); $sr = New-Object IO.StreamReader($fs)
      $text = $sr.ReadToEnd(); $sr.Dispose(); $fs.Dispose()
      if ($text.Length -gt $script:seen) { foreach ($l in ($text.Substring($script:seen) -split "`r?`n")) { if ($l.Trim()) { Log ('  ' + $l.Trim()) } }; $script:seen = $text.Length }
    } catch { }
  }
  while (-not $p.HasExited) { Pump; Start-Sleep -Milliseconds 300; & $tail }
  & $tail
  Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue
  return $p.ExitCode
}

# ---------- Icon and shortcuts ----------
function Make-Icon([string]$path) {
  $bmp = New-Object Drawing.Bitmap 64, 64
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([Drawing.Color]::Transparent)
  $green = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(47, 111, 98))
  $gp = New-Object Drawing.Drawing2D.GraphicsPath
  $r = 14; $gp.AddArc(2, 2, $r * 2, $r * 2, 180, 90); $gp.AddArc(62 - $r * 2, 2, $r * 2, $r * 2, 270, 90); $gp.AddArc(62 - $r * 2, 62 - $r * 2, $r * 2, $r * 2, 0, 90); $gp.AddArc(2, 62 - $r * 2, $r * 2, $r * 2, 90, 90); $gp.CloseFigure()
  $g.FillPath($green, $gp)
  $pen = New-Object Drawing.Pen ([Drawing.Color]::White), 5
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  foreach ($x in 18, 29) { $g.DrawLine($pen, $x, 17, $x, 47) }
  $g.DrawLine($pen, 39, 18, 49, 46)
  $g.Dispose()
  $icon = [Drawing.Icon]::FromHandle($bmp.GetHicon())
  $fs = [IO.File]::Create($path); $icon.Save($fs); $fs.Dispose()
  $bmp.Dispose()
}
function Make-Shortcut([string]$lnk, [string]$icon) {
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $s.Arguments = "//B //Nologo `"$Root\scripts\launch\Biblioteka.vbs`""
  $s.WorkingDirectory = $Root
  $s.IconLocation = $icon
  $s.Description = 'Biblioteka'
  $s.Save()
}

# ---------- The whole installation ----------
function Do-Install([string]$site, [bool]$shortcuts) {
  $warn = @()
  # 1. Node.js
  if ((Node-Major) -ge 24) { Log ((T 'Node.js is ready: {0}' 'Node.js е готов: {0}') -f ((& (Find-Node) -v) | Select-Object -First 1)) }
  else {
    if (Find-Node) { Log (T 'The Node.js on this computer is older than 24; installing the latest.' 'Node.js на този компютър е по-стар от 24; инсталирам последната.') }
    Install-Node
    if ((Node-Major) -lt 24) { throw (T 'Node.js 24 or newer is still not available. Close this window, open it again and retry.' 'Node.js 24 или по-нов още не е достъпен. Затвори прозореца, отвори го пак и опитай отново.') }
    Log ((T 'Node.js installed: {0}' 'Node.js е инсталиран: {0}') -f ((& (Find-Node) -v) | Select-Object -First 1))
  }
  $node = Find-Node

  # 2. Libraries
  if (Test-Path -LiteralPath (Join-Path $Root 'node_modules\express')) { Log (T 'The libraries are already installed.' 'Библиотеките вече са инсталирани.') }
  else {
    Log (T 'Installing the libraries (needs the internet, 1 to 3 minutes)...' 'Инсталирам библиотеките (иска интернет, 1 до 3 минути)...')
    $code = Run-Logged 'npm install --no-fund --no-audit'
    if ($code -ne 0) { throw ((T 'npm install failed (code {0}). See outputs\install.log.' 'npm install не успя (код {0}). Виж outputs\install.log.') -f $code) }
  }

  # 3. Site name (optional)
  $host_ = ''
  if ($site) {
    Log ((T 'Saving the site name {0} (Windows will ask for permission)...' 'Записвам името на сайта {0} (Windows ще поиска разрешение)...') -f $site)
    try {
      $p = Start-Process -FilePath $node -ArgumentList @("`"$Root\scripts\hosts.js`"", 'set', $site) -Verb RunAs -Wait -PassThru -WindowStyle Hidden
      $shown = (& $node "$Root\scripts\hosts.js" show | Select-Object -First 1)
      if ($shown -eq $site.ToLower()) { $host_ = $site.ToLower(); Log (T 'The name is saved.' 'Името е записано.') }
      else { $warn += (T 'The site name was not saved (invalid name, or permission was refused). You can set it later in Settings -> Site address.' 'Името на сайта не е записано (невалидно име или отказано разрешение). Можеш да го зададеш по-късно в Настройки -> Адрес на сайта.') }
    } catch { $warn += (T 'The site name was not saved (permission refused). You can set it later in Settings -> Site address.' 'Името на сайта не е записано (отказано разрешение). Можеш да го зададеш по-късно в Настройки -> Адрес на сайта.') }
  }
  $launch = Join-Path $Root '.launch.json'
  $cfg = @{ mode = 'normal'; host = ''; port = 4321 }
  if (Test-Path -LiteralPath $launch) { try { $old = Get-Content -LiteralPath $launch -Raw | ConvertFrom-Json; if ($old.mode) { $cfg.mode = $old.mode }; if ($old.port) { $cfg.port = $old.port }; $cfg.host = $old.host } catch { } }
  if ($host_) { $cfg.host = $host_ }
  [IO.File]::WriteAllText($launch, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

  # 4. Shortcuts
  if ($shortcuts) {
    try {
      $ico = Join-Path $Root 'scripts\launch\library.ico'
      Make-Icon $ico
      $desktop = [Environment]::GetFolderPath('Desktop')
      $start = Join-Path ([Environment]::GetFolderPath('Programs')) 'Biblioteka.lnk'
      Make-Shortcut (Join-Path $desktop 'Biblioteka.lnk') $ico
      Make-Shortcut $start $ico
      Log (T 'Shortcuts created on the desktop and in the Start menu.' 'Преките пътища са създадени на работния плот и в менюто Старт.')
    } catch { $warn += ((T 'Shortcuts could not be created: {0}' 'Преките пътища не можаха да се създадат: {0}') -f $_.Exception.Message) }
  }
  return $warn
}
function Open-Library { Start-Process -FilePath 'wscript.exe' -ArgumentList @('//B', '//Nologo', "`"$Root\scripts\launch\Biblioteka.vbs`"") }

# ---------- No window ----------
if ($Silent) {
  try {
    $w = @(Do-Install $SiteName (-not $NoShortcuts) | Where-Object { $_ -is [string] -and $_.Trim() })
    foreach ($x in $w) { Log ('! ' + $x) }
    Log (T 'Ready.' 'Готово.')
    if (-not $NoStart) { Open-Library }
    exit 0
  } catch { Log ('ERROR: ' + $_.Exception.Message); exit 1 }
}

# ---------- The setup window ----------
[System.Windows.Forms.Application]::EnableVisualStyles()
$font = New-Object Drawing.Font('Segoe UI', 10)
$green = [Drawing.Color]::FromArgb(47, 111, 98)
$form = New-Object Windows.Forms.Form
$form.Text = T 'Biblioteka - setup' 'Библиотека - инсталация'
$form.ClientSize = New-Object Drawing.Size(660, 460)
$form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false; $form.Font = $font
$form.BackColor = [Drawing.Color]::FromArgb(246, 243, 236)

$head = New-Object Windows.Forms.Panel; $head.Dock = 'Top'; $head.Height = 74; $head.BackColor = $green
$title = New-Object Windows.Forms.Label; $title.ForeColor = [Drawing.Color]::White; $title.Font = New-Object Drawing.Font('Segoe UI Semibold', 16); $title.AutoSize = $true; $title.Location = New-Object Drawing.Point(24, 14)
$sub = New-Object Windows.Forms.Label; $sub.ForeColor = [Drawing.Color]::FromArgb(215, 233, 226); $sub.AutoSize = $true; $sub.Location = New-Object Drawing.Point(26, 46)
$head.Controls.AddRange(@($title, $sub)); $form.Controls.Add($head)

$foot = New-Object Windows.Forms.Panel; $foot.Dock = 'Bottom'; $foot.Height = 58
$btnNext = New-Object Windows.Forms.Button; $btnNext.Size = New-Object Drawing.Size(120, 32); $btnNext.Location = New-Object Drawing.Point(396, 13); $btnNext.FlatStyle = 'Flat'; $btnNext.BackColor = $green; $btnNext.ForeColor = [Drawing.Color]::White
$btnBack = New-Object Windows.Forms.Button; $btnBack.Size = New-Object Drawing.Size(100, 32); $btnBack.Location = New-Object Drawing.Point(286, 13); $btnBack.Text = T 'Back' 'Назад'
$btnCancel = New-Object Windows.Forms.Button; $btnCancel.Size = New-Object Drawing.Size(100, 32); $btnCancel.Location = New-Object Drawing.Point(526, 13); $btnCancel.Text = T 'Cancel' 'Отказ'
$foot.Controls.AddRange(@($btnBack, $btnNext, $btnCancel)); $form.Controls.Add($foot)

function New-Page { $p = New-Object Windows.Forms.Panel; $p.Location = New-Object Drawing.Point(0, 74); $p.Size = New-Object Drawing.Size(660, 328); $p.Visible = $false; $form.Controls.Add($p); return $p }
function New-Label([string]$text, [int]$x, [int]$y, [int]$w, [int]$h) { $l = New-Object Windows.Forms.Label; $l.Text = $text; $l.Location = New-Object Drawing.Point($x, $y); $l.Size = New-Object Drawing.Size($w, $h); return $l }

# Page 0: welcome
$p0 = New-Page
$p0.Controls.Add((New-Label (T "This will get the library ready on this computer. It takes a few minutes and needs the internet.`n`nWhat will be done:" "Това ще подготви библиотеката на този компютър. Отнема няколко минути и иска интернет.`n`nКакво ще се направи:") 28 20 600 70))
$p0.Controls.Add((New-Label (T "  1.  Install Node.js (the latest version) if it is missing or too old`n  2.  Install the libraries of the program`n  3.  Create shortcuts (optional) and a name for your local site (optional)`n`nNo AI is installed. You choose the AI model (Claude, another provider, or a model on your computer) inside the app, when you are ready." "  1.  Инсталира Node.js (последната версия), ако липсва или е твърде стар`n  2.  Инсталира библиотеките на програмата`n  3.  Прави преки пътища (по желание) и име за локалния ти сайт (по желание)`n`nНе се инсталира никакъв ИИ. Моделът (Claude, друг доставчик или модел на компютъра ти) се избира в самото приложение, когато си готов.") 28 96 600 190))

# Page 1: options
$p1 = New-Page
$p1.Controls.Add((New-Label (T 'A name for your local site (optional)' 'Име за локалния сайт (по желание)') 28 20 600 24))
$txtSite = New-Object Windows.Forms.TextBox; $txtSite.Location = New-Object Drawing.Point(30, 50); $txtSite.Size = New-Object Drawing.Size(300, 28); $txtSite.Text = $SiteName; $p1.Controls.Add($txtSite)
$p1.Controls.Add((New-Label (T "For example biblioteka.test. Leave it empty to use localhost. Windows will ask for permission to write the name into the hosts file. You can also do this later in the app (Settings -> Site address). Prefer endings like .test or .localhost." "Например biblioteka.test. Остави го празно, за да ползваш localhost. Windows ще поиска разрешение да запише името във файла hosts. Можеш да го направиш и по-късно в приложението (Настройки -> Адрес на сайта). Предпочитай окончания като .test или .localhost.") 28 86 600 70))
$chkShort = New-Object Windows.Forms.CheckBox; $chkShort.Text = T 'Create shortcuts on the desktop and in the Start menu' 'Създай преки пътища на работния плот и в менюто Старт'; $chkShort.Checked = -not $NoShortcuts; $chkShort.Location = New-Object Drawing.Point(30, 176); $chkShort.Size = New-Object Drawing.Size(580, 26); $p1.Controls.Add($chkShort)
$lblSiteErr = New-Label '' 30 206 600 40; $lblSiteErr.ForeColor = [Drawing.Color]::FromArgb(194, 112, 61); $p1.Controls.Add($lblSiteErr)

# Page 2: progress
$p2 = New-Page
$lblStep = New-Label (T 'Working...' 'Работя...') 28 16 600 24; $p2.Controls.Add($lblStep)
$bar = New-Object Windows.Forms.ProgressBar; $bar.Style = 'Marquee'; $bar.MarqueeAnimationSpeed = 30; $bar.Location = New-Object Drawing.Point(30, 46); $bar.Size = New-Object Drawing.Size(596, 14); $p2.Controls.Add($bar)
$logBox = New-Object Windows.Forms.TextBox; $logBox.Multiline = $true; $logBox.ReadOnly = $true; $logBox.ScrollBars = 'Vertical'; $logBox.Location = New-Object Drawing.Point(30, 74); $logBox.Size = New-Object Drawing.Size(596, 240); $logBox.Font = New-Object Drawing.Font('Consolas', 9); $p2.Controls.Add($logBox)

# Page 3: done
$p3 = New-Page
$lblDone = New-Label '' 28 20 600 150; $p3.Controls.Add($lblDone)
$chkOpen = New-Object Windows.Forms.CheckBox; $chkOpen.Text = T 'Open the library now' 'Отвори библиотеката сега'; $chkOpen.Checked = -not $NoStart; $chkOpen.Location = New-Object Drawing.Point(30, 190); $chkOpen.Size = New-Object Drawing.Size(400, 26); $p3.Controls.Add($chkOpen)

$pages = @($p0, $p1, $p2, $p3)
$script:page = 0
$script:busy = $false
$script:ok = $false
$titles = @(
  @((T 'Welcome' 'Добре дошъл'), (T 'Your personal library, ready in a few minutes' 'Личната ти библиотека, готова за няколко минути')),
  @((T 'Options' 'Настройки'), (T 'Both are optional' 'И двете са по желание')),
  @((T 'Installing' 'Инсталиране'), (T 'Please wait. Windows may ask for permission once or twice.' 'Моля, изчакай. Windows може да поиска разрешение веднъж или два пъти.')),
  @((T 'Done' 'Готово'), (T 'Everything is in place' 'Всичко е на място'))
)
function Show-Page([int]$i) {
  $script:page = $i
  for ($k = 0; $k -lt $pages.Count; $k++) { $pages[$k].Visible = ($k -eq $i) }
  $title.Text = $titles[$i][0]; $sub.Text = $titles[$i][1]
  $btnBack.Visible = ($i -eq 1); $btnCancel.Visible = ($i -lt 3); $btnNext.Enabled = $true
  switch ($i) { 0 { $btnNext.Text = T 'Next' 'Напред' } 1 { $btnNext.Text = T 'Install' 'Инсталирай' } 2 { $btnNext.Text = T 'Please wait' 'Изчакай'; $btnNext.Enabled = $false } 3 { $btnNext.Text = T 'Finish' 'Край' } }
}
$script:Sink = { param($line) $logBox.AppendText($line + "`r`n"); $m = $line -replace '^\[[^\]]*\]\s*', ''; if (-not $m.StartsWith('  ')) { $lblStep.Text = $m }; Pump }

function Run-Install {
  $script:busy = $true
  Show-Page 2
  $logBox.Clear()
  try {
    $w = @(Do-Install ($txtSite.Text.Trim()) ([bool]$chkShort.Checked) | Where-Object { $_ -is [string] -and $_.Trim() })
    $script:ok = $true
    $msg = T "The library is installed.`n`nOpen it with the shortcut `"Biblioteka`". It opens in its own window, and when you close that window the program stops. There is no extra window with a server.`n`nNext step: in the app, choose the AI model (Settings -> Model), or follow the welcome tour." "Библиотеката е инсталирана.`n`nОтваряш я с прекия път „Biblioteka“. Отваря се в собствен прозорец, а като го затвориш, програмата се спира. Няма допълнителен прозорец със сървър.`n`nСледваща стъпка: в приложението избери ИИ модел (Настройки -> Модел) или мини през обиколката."
    if ($w.Count -gt 0) { $msg += "`n`n" + (($w | ForEach-Object { '! ' + $_ }) -join "`n") }
    $lblDone.Text = $msg
    $chkOpen.Visible = $true
  } catch {
    $script:ok = $false
    Log ('ERROR: ' + $_.Exception.Message)
    $lblDone.Text = (T "Setup did not finish.`n`n" "Инсталацията не завърши.`n`n") + $_.Exception.Message + "`n`n" + (T "Details: outputs\install.log. You can run the setup again." "Подробности: outputs\install.log. Можеш да пуснеш инсталацията отново.")
    $chkOpen.Visible = $false
    $title.Text = T 'Something went wrong' 'Нещо се обърка'
  }
  $script:busy = $false
  $bar.Style = 'Continuous'
  Show-Page 3
  if (-not $script:ok) { $title.Text = T 'Something went wrong' 'Нещо се обърка'; $sub.Text = '' }
}

$btnNext.Add_Click({
  switch ($script:page) {
    0 { Show-Page 1 }
    1 {
      $n = $txtSite.Text.Trim()
      if ($n -and $n -notmatch '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?){0,3}$') { $lblSiteErr.Text = T 'Use letters, digits and hyphens, with dots between the parts (for example biblioteka.test).' 'Ползвай букви, цифри и тирета, с точки между частите (например biblioteka.test).'; return }
      $lblSiteErr.Text = ''
      Run-Install
    }
    3 { if ($script:ok -and $chkOpen.Checked) { Open-Library }; $form.Close() }
  }
})
$btnBack.Add_Click({ if ($script:page -eq 1) { Show-Page 0 } })
$btnCancel.Add_Click({ if (-not $script:busy) { $form.Close() } })
$form.Add_FormClosing({ param($s, $e) if ($script:busy) { $e.Cancel = $true } })

Show-Page 0
[void]$form.ShowDialog()
