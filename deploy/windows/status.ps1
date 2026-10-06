<#
  OmniConnect - one-screen health check of a Windows Server deployment. Changes nothing.

      powershell -ExecutionPolicy Bypass -File C:\OmniConnect\scripts\status.ps1 -Domain omniconnect.company.com
#>
param(
    [Parameter(Mandatory = $true)][string]$Domain,
    [string]$Distro = 'Ubuntu-24.04',
    [string]$RepoPath = ''
)
function Line([bool]$good, [string]$what, [string]$detail) {
    $tag = $(if ($good) { '[ OK ]' } else { '[FAIL]' })
    $color = $(if ($good) { 'Green' } else { 'Red' })
    Write-Host ("{0} {1}  {2}" -f $tag, $what, $detail) -ForegroundColor $color
}

Write-Host ""
Write-Host "OmniConnect status - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan

$state = ((wsl.exe -l -v 2>$null) -replace "`0", '') | Where-Object { $_ -match [regex]::Escape($Distro) }
Line ([bool]($state -match 'Running')) "Ubuntu ($Distro)" ($state -replace '\s+', ' ').Trim()

$task = Get-ScheduledTask -TaskName 'OmniConnect - keep platform running' -ErrorAction SilentlyContinue
Line ([bool]($task -and $task.State -eq 'Running')) 'Task: keep platform running' $(if ($task) { $task.State } else { 'not registered' })
$backup = Get-ScheduledTask -TaskName 'OmniConnect - nightly database backup' -ErrorAction SilentlyContinue
$info = $(if ($backup) { Get-ScheduledTaskInfo -TaskName 'OmniConnect - nightly database backup' })
Line ([bool]($backup -and ($info.LastTaskResult -eq 0 -or $info.LastRunTime.Year -lt 2000))) 'Task: nightly backup' $(if ($backup) { "last run $($info.LastRunTime), result $($info.LastTaskResult)" } else { 'not registered' })

$caddy = Get-Service OmniConnectCaddy -ErrorAction SilentlyContinue
Line ([bool]($caddy -and $caddy.Status -eq 'Running')) 'Service: Caddy (HTTPS)' $(if ($caddy) { $caddy.Status } else { 'not installed' })

$linuxUser = ((wsl.exe -d $Distro -- whoami 2>$null) -replace "`0", '').Trim()
if (-not $RepoPath) { $RepoPath = "/home/$linuxUser/OmniConnectt" }
# As root: the platform runs under rootful Podman (a plain user would see an empty, rootless store).
$ps = (wsl.exe -d $Distro -u root -- bash -lc "cd $RepoPath/deploy && podman compose ps --format '{{.Service}} {{.Status}}'" 2>$null) -replace "`0", ''
foreach ($svc in 'web', 'auth', 'lead', 'c360', 'products', 'db') {
    $row = $ps | Where-Object { $_ -match "^$svc " } | Select-Object -First 1
    if ($svc -eq 'db' -and -not $row) { continue }
    Line ([bool]($row -match 'healthy' -and $row -notmatch 'unhealthy')) "Container: $svc" $(if ($row) { ($row -split ' ', 2)[1] } else { 'not running' })
}

try {
    $local = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/healthz' -UseBasicParsing -TimeoutSec 5
    Line ($local.StatusCode -eq 200) 'nginx via WSL localhost forwarding' "HTTP $($local.StatusCode)"
} catch { Line $false 'nginx via WSL localhost forwarding' $_.Exception.Message }

try {
    $req = [Net.HttpWebRequest]::Create("https://$Domain/healthz")
    $req.Timeout = 10000
    $resp = $req.GetResponse()
    $cert = [Security.Cryptography.X509Certificates.X509Certificate2]$req.ServicePoint.Certificate
    $resp.Close()
    $days = [int]($cert.NotAfter - (Get-Date)).TotalDays
    Line ($days -gt 10) "https://$Domain" "certificate valid until $($cert.NotAfter.ToString('yyyy-MM-dd')) ($days days; renews automatically at 30)"
} catch { Line $false "https://$Domain" $_.Exception.Message }

try {
    $rm = Invoke-WebRequest -Uri "https://$Domain/release-manifest.json" -UseBasicParsing -TimeoutSec 10 | ConvertFrom-Json
    $apps = ($rm.remotes.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value.version)" }) -join ', '
    Line $true 'Live release' "$($rm.releaseVersion) - host $($rm.host.version); $apps"
} catch { Line $false 'Live release' 'release-manifest.json not readable' }
Write-Host ""
