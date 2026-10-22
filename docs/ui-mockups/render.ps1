# Screenshots every mockup in mockups.html to a PNG next to this script, using headless Chrome.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$profile = Join-Path $env:TEMP 'roboware-mockup-chrome'
$page = 'file:///' + ((Join-Path $here 'mockups.html') -replace '\\', '/')

$shots = @{
  before = '1440,860'; session = '1440,900'; map = '1240,800'; shortcuts = '1440,900'; models = '1440,900'; learn = '1440,900'
  layouts = '1440,860'; compare = '1440,900'; replay = '1440,900'; dark = '1440,900'; firstrun = '1440,800'; narrow = '1024,900'
}

foreach ($name in $shots.Keys) {
  $out = Join-Path $here "$name.png"
  & $chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files `
    "--user-data-dir=$profile" "--window-size=$($shots[$name])" --virtual-time-budget=4000 "--screenshot=$out" "$page`?m=$name" 2>$null | Out-Null
  Write-Output "$name -> $(Test-Path $out)"
}
