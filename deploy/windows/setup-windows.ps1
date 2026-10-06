<#
  OmniConnect - Windows side of a Windows Server 2022 deployment. Run AFTER the platform is deployed
  inside Ubuntu (WSL) and answers on http://127.0.0.1:8080 (see docs/DEPLOY-WINDOWS-SERVER-2022.md).

  Run in PowerShell AS ADMINISTRATOR:
      powershell -ExecutionPolicy Bypass -File C:\OmniConnect\scripts\setup-windows.ps1 -Domain omniconnect.company.com -Email it-team@company.com

  What it does (safe to run again; it updates what already exists):
    1. Checks that the platform answers inside WSL and from Windows.
    2. Downloads Caddy (official release, SHA-512 verified) to C:\OmniConnect\caddy.
    3. Writes the Caddyfile: HTTPS for -Domain with an automatic Let's Encrypt certificate, HTTP to
       HTTPS redirect, and proxying to nginx on 127.0.0.1:8080 with the visitor's real address.
    4. Installs Caddy as a Windows service that starts with the server.
    5. Opens ports 80 and 443 in Windows Firewall.
    6. Registers two scheduled tasks under YOUR Windows account (WSL belongs to the account that
       installed it): one keeps Ubuntu - and with it Podman and the platform - running from boot, without
       anyone logged in; one makes the nightly database backup.
       Windows asks for YOUR password once for this; type it into the Windows prompt, nowhere else.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Domain,
    [Parameter(Mandatory = $true)][string]$Email,
    [string]$Distro = 'Ubuntu-24.04',
    [string]$RepoPath = '',
    [string]$CaddyVersion = '2.10.2',
    [string]$BackupTime = '02:00'
)
$ErrorActionPreference = 'Stop'
$Root = 'C:\OmniConnect'
$CaddyDir = Join-Path $Root 'caddy'

function Step([string]$text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Fail([string]$text) { Write-Host "    FAIL  $text" -ForegroundColor Red; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail 'Run this in PowerShell opened with "Run as administrator".' }
if ($Domain -notmatch '^[A-Za-z0-9.-]+$') { Fail "'$Domain' is not a host name." }

# ---------------------------------------------------------------------------------------------------
Step '1. Checking the platform inside Ubuntu'
$distros = (wsl.exe -l -q 2>$null) -replace "`0", '' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if ($distros -notcontains $Distro) { Fail "WSL distribution '$Distro' not found for this Windows user. Installed: $($distros -join ', ')" }
$linuxUser = ((wsl.exe -d $Distro -- whoami) -replace "`0", '').Trim()
if (-not $RepoPath) { $RepoPath = "/home/$linuxUser/OmniConnectt" }
$code = ((wsl.exe -d $Distro -- curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz) -replace "`0", '').Trim()
if ($code -ne '200') { Fail "nginx does not answer inside Ubuntu on 127.0.0.1:8080 (got '$code'). Finish the deploy steps in the guide first." }
Ok "nginx answers inside Ubuntu (user $linuxUser, repo $RepoPath)"
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/healthz' -UseBasicParsing -TimeoutSec 10
    Ok "Windows reaches it through WSL localhost forwarding (HTTP $($r.StatusCode))"
} catch {
    Fail "Windows cannot reach http://127.0.0.1:8080 although Ubuntu can. Check that %UserProfile%\.wslconfig does not set localhostForwarding=false, then run: wsl --shutdown, and start Ubuntu again."
}

# ---------------------------------------------------------------------------------------------------
Step "2. Installing Caddy $CaddyVersion"
New-Item -ItemType Directory -Force -Path $CaddyDir, (Join-Path $CaddyDir 'data') | Out-Null
$caddyExe = Join-Path $CaddyDir 'caddy.exe'
$haveVersion = ''
if (Test-Path $caddyExe) { $haveVersion = (& $caddyExe version) -join ' ' }
if ($haveVersion -match [regex]::Escape("v$CaddyVersion")) {
    Ok "Caddy $CaddyVersion already installed"
} else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $base = "https://github.com/caddyserver/caddy/releases/download/v$CaddyVersion"
    $zipName = "caddy_${CaddyVersion}_windows_amd64.zip"
    $zip = Join-Path $env:TEMP $zipName
    $sums = Join-Path $env:TEMP "caddy_${CaddyVersion}_checksums.txt"
    Invoke-WebRequest -Uri "$base/$zipName" -OutFile $zip -UseBasicParsing
    Invoke-WebRequest -Uri "$base/caddy_${CaddyVersion}_checksums.txt" -OutFile $sums -UseBasicParsing
    $expected = (Select-String -Path $sums -Pattern ([regex]::Escape($zipName)) | Select-Object -First 1).Line.Split(' ')[0].ToLower()
    $actual = (Get-FileHash -Path $zip -Algorithm SHA512).Hash.ToLower()
    if (-not $expected -or $expected -ne $actual) { Fail "Checksum mismatch for $zipName - the download is corrupt or not genuine. Nothing was installed." }
    Ok 'Download verified (SHA-512 matches the official checksums)'
    $svc = Get-Service -Name 'OmniConnectCaddy' -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') { Stop-Service OmniConnectCaddy }
    $unpack = Join-Path $env:TEMP "caddy_$CaddyVersion"
    Expand-Archive -Path $zip -DestinationPath $unpack -Force
    Copy-Item -Path (Join-Path $unpack 'caddy.exe') -Destination $caddyExe -Force
    Remove-Item $zip, $sums -Force; Remove-Item $unpack -Recurse -Force
    Ok "Installed $caddyExe"
}

# ---------------------------------------------------------------------------------------------------
Step '3. Writing the Caddyfile'
$caddyfile = Join-Path $CaddyDir 'Caddyfile'
$dataDir = ($CaddyDir -replace '\\', '/') + '/data'
@"
# Generated by deploy/windows/setup-windows.ps1 - edit there, not here.
{
	email $Email
	storage file_system $dataDir
}

$Domain {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	# Caddy sends the visitor's real address in X-Forwarded-For (ignoring any value the visitor sent);
	# nginx inside Ubuntu trusts it because it only listens on 127.0.0.1 (EDGE_PROXY=local-proxy).
	# No access log here on purpose: nginx logs requests without their query string, which carries
	# sign-in tokens for live updates.
	reverse_proxy 127.0.0.1:8080
}
"@ | Set-Content -Path $caddyfile -Encoding ascii
& $caddyExe validate --config $caddyfile --adapter caddyfile 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { & $caddyExe validate --config $caddyfile --adapter caddyfile; Fail 'The Caddyfile is not valid (see above).' }
Ok "$caddyfile (domain $Domain)"

# ---------------------------------------------------------------------------------------------------
Step '4. Caddy as a Windows service'
$svc = Get-Service -Name 'OmniConnectCaddy' -ErrorAction SilentlyContinue
$binPath = "`"$caddyExe`" run --config `"$caddyfile`" --adapter caddyfile"
if (-not $svc) {
    & sc.exe create OmniConnectCaddy start= auto binPath= $binPath DisplayName= 'OmniConnect HTTPS (Caddy)' | Out-Null
    & sc.exe description OmniConnectCaddy 'Public HTTPS entry for OmniConnect: certificates and proxy to the platform in WSL.' | Out-Null
} else {
    & sc.exe config OmniConnectCaddy start= auto binPath= $binPath | Out-Null
}
& sc.exe failure OmniConnectCaddy reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
Restart-Service OmniConnectCaddy -ErrorAction SilentlyContinue
if ((Get-Service OmniConnectCaddy).Status -ne 'Running') { Start-Service OmniConnectCaddy }
Start-Sleep -Seconds 3
if ((Get-Service OmniConnectCaddy).Status -ne 'Running') { Fail 'The Caddy service did not start. Run it in the foreground to see why: C:\OmniConnect\caddy\caddy.exe run --config C:\OmniConnect\caddy\Caddyfile' }
Ok 'Service OmniConnectCaddy is running and starts automatically'

# ---------------------------------------------------------------------------------------------------
Step '5. Windows Firewall'
if (-not (Get-NetFirewallRule -DisplayName 'OmniConnect HTTP/HTTPS' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'OmniConnect HTTP/HTTPS' -Direction Inbound -Protocol TCP -LocalPort 80, 443 -Action Allow -Profile Any | Out-Null
}
Ok 'Inbound TCP 80 and 443 allowed'

# ---------------------------------------------------------------------------------------------------
Step '6. Scheduled tasks (keep the platform running; nightly backup)'
$account = "$env:USERDOMAIN\$env:USERNAME"
Write-Host "    Windows will ask for the password of $account, so the tasks can run while nobody is logged in."
$cred = Get-Credential -UserName $account -Message "Password of $account (used only by Windows Task Scheduler)"
$plain = $cred.GetNetworkCredential().Password

# Keep-alive: starting the distribution boots systemd, whose podman-restart.service starts every
# container with restart policy "always" (all of ours). The task's process keeps the distribution running.
$keepAction = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $Distro --exec /bin/sleep infinity"
$keepTrigger = New-ScheduledTaskTrigger -AtStartup
$keepSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName 'OmniConnect - keep platform running' -Action $keepAction -Trigger $keepTrigger -Settings $keepSettings -User $account -Password $plain -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'OmniConnect - keep platform running'
Ok 'OmniConnect - keep platform running (at startup, no time limit, restarts if it stops)'

$backupCmd = "cd $RepoPath/deploy && scripts/backup-db.sh >> /srv/omniconnect-backups/backup.log 2>&1"
# As root: the platform runs under rootful Podman.
$backupAction = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $Distro -u root -- bash -lc `"$backupCmd`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At $BackupTime
$backupSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -StartWhenAvailable -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName 'OmniConnect - nightly database backup' -Action $backupAction -Trigger $backupTrigger -Settings $backupSettings -User $account -Password $plain -RunLevel Highest -Force | Out-Null
Ok "OmniConnect - nightly database backup (daily at $BackupTime)"
$plain = $null

# ---------------------------------------------------------------------------------------------------
Step '7. Checking HTTPS'
Write-Host "    Caddy now requests a certificate for $Domain from Let's Encrypt. That only works when the"
Write-Host "    domain's DNS points at this server's public address and ports 80/443 reach it from the internet."
$deadline = (Get-Date).AddMinutes(2)
$https = $false
while ((Get-Date) -lt $deadline -and -not $https) {
    try { $r = Invoke-WebRequest -Uri "https://$Domain/healthz" -UseBasicParsing -TimeoutSec 10; $https = ($r.StatusCode -eq 200) } catch { Start-Sleep -Seconds 10 }
}
if ($https) {
    Ok "https://$Domain answers with a valid certificate"
} else {
    Write-Host "    Not reachable yet over HTTPS. If DNS or the company firewall is not ready, that is expected:" -ForegroundColor Yellow
    Write-Host "    Caddy keeps retrying on its own. Check later with: powershell -ExecutionPolicy Bypass -File C:\OmniConnect\scripts\status.ps1 -Domain $Domain" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Open https://$Domain from your laptop." -ForegroundColor Green
