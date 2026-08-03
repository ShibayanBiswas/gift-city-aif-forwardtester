$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:8000'
$ui = 'http://127.0.0.1:3000'
$out = @()
function Check([string]$n, [bool]$ok, [string]$d = '') {
  $script:out += [pscustomobject]@{ Name = $n; OK = $ok; Detail = $d }
  if ($ok) { Write-Host "PASS $n $d" } else { Write-Host "FAIL $n $d" }
}

try {
  Invoke-WebRequest $ui -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
  Start-Process -FilePath npm -ArgumentList @('run', 'dev', '--', '-p', '3000') -WorkingDirectory 'C:\Users\shiba\OneDrive\Desktop\Gift AIF Forwardtester\frontend' -WindowStyle Hidden
  Start-Sleep -Seconds 10
}

$h = Invoke-RestMethod "$base/api/health"
Check 'health' ($h.ok -eq $true) $h.service

$prod = Invoke-RestMethod "$base/api/product/current"
Check 'product' (($prod.tenure_days -eq 1930) -and ($prod.n_paths -eq 100)) "tenure=$($prod.tenure_days) n=$($prod.n_paths)"

$meta = Invoke-RestMethod "$base/api/market/meta"
Check 'market_meta' (($meta.tenure_days -eq 1930) -and ($meta.n_paths -eq 100) -and ($meta.trading_days -gt 800)) ("td=$($meta.trading_days) n=$($meta.n_paths) end=$($meta.product_end)")

$gbm = Invoke-RestMethod "$base/api/gbm/params"
Check 'gbm' ($gbm.gbm.spot0 -gt 10000) ("S0=$([math]::Round($gbm.gbm.spot0, 2))")

$job = (Invoke-RestMethod -Method Post -Uri "$base/api/forwardtest/run" -ContentType 'application/json' -Body (@{ n_paths = 5 } | ConvertTo-Json)).job_id
Check 'run' ($null -ne $job) $job
$deadline = (Get-Date).AddMinutes(8)
do {
  Start-Sleep 2
  $st = Invoke-RestMethod "$base/api/forwardtest/$job/status"
  if ($st.status -in @('done', 'error', 'cancelled')) { break }
} while ((Get-Date) -lt $deadline)
Check 'done' ($st.status -eq 'done') "$($st.status) $($st.progress)"

$sum = Invoke-RestMethod "$base/api/forwardtest/$job/summary"
Check 'mc' (($sum.mc_matrix.n_paths -eq $sum.path_count) -and ($sum.path_count -eq 5) -and ($sum.mc_matrix.n_dates -gt 800)) "$($sum.mc_matrix.n_paths)x$($sum.mc_matrix.n_dates)"
Check 'same_window' (($sum.summary[0].start -eq $sum.summary[1].start) -and ($sum.summary[0].end -eq $sum.summary[1].end)) "start=$($sum.summary[0].start) end=$($sum.summary[0].end)"

$prev = Invoke-RestMethod "$base/api/forwardtest/$job/mc-matrix/preview?max_paths=5&max_dates=10"
# Rows are Path · Start Date · End Date · trading dates… — S0 (col index 3) is shared; path divergence starts at index 4+.
Check 'preview_meta' (($prev.headers[0] -eq 'Path') -and ($prev.headers[1] -eq 'Start Date') -and ($prev.headers[2] -eq 'End Date')) ("h0=$($prev.headers[0])")
Check 'preview_diff' ([math]::Abs([double]$prev.rows[0][4] - [double]$prev.rows[1][4]) -gt 1e-6) ("p0=$($prev.rows[0][4]) p1=$($prev.rows[1][4])")

Invoke-RestMethod -Method Post -Uri "$base/api/forwardtest/$job/mc-matrix/export" | Out-Null
$xlsxDeadline = (Get-Date).AddMinutes(5)
do {
  Start-Sleep 1
  $xst = Invoke-RestMethod "$base/api/forwardtest/$job/mc-matrix/export"
  if ($xst.status -in @('ready', 'error')) { break }
} while ((Get-Date) -lt $xlsxDeadline)
Check 'xlsx_ready' ($xst.status -eq 'ready') "$($xst.status) $($xst.message)"
$xlsx = Join-Path $env:TEMP "mc-$job.xlsx"
Invoke-WebRequest "$base/api/forwardtest/$job/mc-matrix.xlsx" -OutFile $xlsx
Check 'xlsx' ((Get-Item $xlsx).Length -gt 5000) "$((Get-Item $xlsx).Length)"

$paths = Invoke-RestMethod "$base/api/forwardtest/$job/paths"
$d1 = Invoke-RestMethod "$base/api/forwardtest/$job/paths/$($paths.paths[0].path_id)"
$d2 = Invoke-RestMethod "$base/api/forwardtest/$job/paths/$($paths.paths[1].path_id)"
Check 'path_market' (($d1.nifty.Count -gt 100) -and ($d1.rolls.Count -gt 0) -and ($d1.monthly_expiries.Count -gt 0)) "n=$($d1.nifty.Count) r=$($d1.rolls.Count) e=$($d1.monthly_expiries.Count)"

$h1 = Invoke-RestMethod "$base/api/forwardtest/$job/paths/$($paths.paths[0].path_id)/horizon-market"
$h2 = Invoke-RestMethod "$base/api/forwardtest/$job/paths/$($paths.paths[1].path_id)/horizon-market"
Check 'horizon_full' (($h1.n_trading_days -eq $sum.mc_matrix.n_dates) -and ($h1.n_trading_days -gt 800)) "days=$($h1.n_trading_days) matrix=$($sum.mc_matrix.n_dates)"
Check 'horizon_nifty_diff' ([math]::Abs([double]$h1.nifty[50] - [double]$h2.nifty[50]) -gt 1e-6) ''
$hr1 = @{}
foreach ($r in $h1.rolls) { $hr1[$r.shift_date] = $r.roll_cost }
$hRollDiff = $false
foreach ($r in $h2.rolls) {
  if ($hr1.ContainsKey($r.shift_date) -and [math]::Abs($hr1[$r.shift_date] - $r.roll_cost) -gt 1e-6) { $hRollDiff = $true; break }
}
Check 'horizon_rolls_diff' $hRollDiff "rolls=$($h1.n_rolls) exp=$($h1.n_expiries)"

$r1 = @{}
foreach ($r in $d1.rolls) { $r1[$r.shift_date] = $r.roll_cost }
$rollDiff = $false
foreach ($r in $d2.rolls) {
  if ($r1.ContainsKey($r.shift_date) -and [math]::Abs($r1[$r.shift_date] - $r.roll_cost) -gt 1e-6) { $rollDiff = $true; break }
}
Check 'rolls_path_local' $rollDiff ''

$hedge = Invoke-RestMethod "$base/api/forwardtest/$job/paths/$($paths.paths[0].path_id)/hedging"
$uniqueLegs = ($hedge.legs | Group-Object strike_pct, raw_qty).Count
Check 'hedge_legs' (($uniqueLegs -eq 6) -and ($hedge.obs_builds.Count -gt 0) -and ($hedge.legs.Count -ge 6)) "unique=$uniqueLegs rows=$($hedge.legs.Count) obs=$($hedge.obs_builds.Count)"

$comp = Invoke-RestMethod "$base/api/forwardtest/$job/paths/$($paths.paths[0].path_id)/computation"
Check 'computation' ($comp.rows.Count -gt 100) "rows=$($comp.rows.Count)"

$pages = @('/', '/product', '/paths', '/hedging', '/computation', '/analytics', '/analytics/summary', '/intel', '/intel/matrix', '/intel/logic')
foreach ($p in $pages) {
  try {
    $r = Invoke-WebRequest "$ui$p" -UseBasicParsing -TimeoutSec 45
    $hasBrand = $r.Content -match 'Forwardtester|Anand Rathi|font-display|Gift'
    Check "ui$p" (($r.StatusCode -eq 200) -and ($r.Content.Length -gt 800) -and $hasBrand) ("len=$($r.Content.Length)")
  } catch {
    Check "ui$p" $false $_.Exception.Message
  }
}

$cssPath = 'C:\Users\shiba\OneDrive\Desktop\Gift AIF Forwardtester\frontend\app\globals.css'
$css = Get-Content $cssPath -Raw
Check 'css_ar_maroon' ($css -match '--ar-maroon:\s*#7a1e2c') ''
Check 'css_meta_chip' ($css -match '\.meta-chip') ''
Check 'css_font_display' ($css -match '\.font-display') ''
Check 'css_path_pill' ($css -match '\.path-pill') ''
Check 'css_market_meta' ($css -match 'market-meta') ''

$fail = @($out | Where-Object { -not $_.OK })
Write-Host "==== pass=$((@($out | Where-Object OK)).Count) fail=$($fail.Count) ===="
$fail | Format-Table -AutoSize
if ($fail.Count -gt 0) { exit 1 } else { exit 0 }
