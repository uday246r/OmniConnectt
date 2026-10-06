<#
  OmniConnect - pre-flight check for a Windows Server 2022 deployment.

  Run in PowerShell AS ADMINISTRATOR:
      powershell -ExecutionPolicy Bypass -File C:\OmniConnect\scripts\check-server.ps1

  It changes nothing. Each line is PASS, WARN or FAIL, and every FAIL says what to do.
  Send the output to your manager/IT if a FAIL needs them (virtualization, ports, disk).
#>
$ErrorActionPreference = 'Continue'
$failures = 0
$warnings = 0

function Report([string]$status, [string]$what, [string]$detail, [string]$fix) {
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red' }[$status]
    Write-Host ("[{0}] {1}" -f $status, $what) -ForegroundColor $color
    if ($detail) { Write-Host ("       {0}" -f $detail) }
    if ($fix -and $status -ne 'PASS') { Write-Host ("       FIX: {0}" -f $fix) -ForegroundColor $color }
    if ($status -eq 'FAIL') { $script:failures++ }
    if ($status -eq 'WARN') { $script:warnings++ }
}

Write-Host ""
Write-Host "OmniConnect pre-flight check - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan
Write-Host ""

# 1. Operating system
$os = Get-CimInstance Win32_OperatingSystem
$ubr = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue).UBR
$build = [int]$os.BuildNumber
if ($os.Caption -match 'Server 2022' -and $build -ge 20348) {
    if ($ubr -ge 740) { Report PASS 'Windows Server 2022' "$($os.Caption), build $build.$ubr" '' }
    else { Report WARN 'Windows Server 2022 needs updates for WSL2' "build $build.$ubr" 'Run Windows Update (Settings > Update & Security) and reboot; WSL2 needs build 20348.740 or newer.' }
} else {
    Report WARN 'Operating system' "$($os.Caption), build $build.$ubr" 'This guide is written for Windows Server 2022. Other versions may need different steps.'
}

# 2. Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { Report PASS 'Running as Administrator' '' '' }
else { Report FAIL 'Not running as Administrator' '' 'Right-click Start > Windows PowerShell (Admin), then run this script again.' }

# 3. Virtualization (WSL2 needs it; on a virtual machine IT must enable NESTED virtualization)
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$isVm = ($cs.Model -match 'Virtual|VMware|KVM|HVM|Xen|VirtualBox') -or ($cs.Manufacturer -match 'VMware|QEMU|Xen|innotek|Microsoft Corporation' -and $cs.Model -match 'Virtual')
$where = $(if ($isVm) { "virtual machine ($($cs.Manufacturer) $($cs.Model))" } else { "physical machine ($($cs.Manufacturer) $($cs.Model))" })
# The definitive proof is a WSL2 distribution actually running. Before that exists, the CPU flags are
# only a hint: inside a VM "a hypervisor is present" is always true (it is the VM's own host), so only
# the exposed virtualization extensions say whether nested virtualization is on.
$wsl2Running = $false
if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
    $list = (wsl.exe -l -v 2>$null) -replace "`0", ''
    $wsl2Running = [bool]($list | Where-Object { $_ -match '\s2\s*$' })
}
$nestedFix = 'Ask IT to enable nested virtualization for this VM (Hyper-V host: Set-VMProcessor -VMName <vm> -ExposeVirtualizationExtensions $true; VMware: "Expose hardware assisted virtualization to the guest OS"), then reboot.'
if ($wsl2Running) {
    Report PASS 'Virtualization works (a WSL2 distribution is installed)' $where ''
} elseif ($cpu.VirtualizationFirmwareEnabled) {
    Report PASS 'Virtualization extensions are available for WSL2' $where ''
} elseif ($isVm) {
    Report WARN 'Cannot confirm nested virtualization yet' $where ("If 'wsl --install' later fails with 0x80370102 or 'virtualization is not enabled': " + $nestedFix)
} elseif ($cs.HypervisorPresent) {
    Report PASS 'Hypervisor already running (Hyper-V/WSL platform active)' $where ''
} else {
    Report FAIL 'Virtualization disabled in firmware' $where 'Enable Intel VT-x / AMD-V in the BIOS/UEFI (ask IT), then reboot.'
}

# 4. Memory and disk
$ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
if ($ramGb -ge 8) { Report PASS 'Memory' "$ramGb GB" '' }
elseif ($ramGb -ge 6) { Report WARN 'Memory is tight' "$ramGb GB" 'Works, but 8 GB or more is recommended (4 services + PostgreSQL + builds).' }
else { Report FAIL 'Not enough memory' "$ramGb GB" 'Ask IT for at least 8 GB RAM.' }

$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$freeGb = [math]::Round($disk.FreeSpace / 1GB, 1)
if ($freeGb -ge 40) { Report PASS 'Free disk space on C:' "$freeGb GB" '' }
elseif ($freeGb -ge 25) { Report WARN 'Free disk space on C: is low' "$freeGb GB" '40 GB or more recommended (images, builds, database, backups).' }
else { Report FAIL 'Not enough free disk space on C:' "$freeGb GB" 'Free up space or ask IT for a larger disk (40 GB+).' }

# 5. Internet
foreach ($target in @('github.com', 'mcr.microsoft.com', 'registry-1.docker.io', 'registry.npmjs.org', 'acme-v02.api.letsencrypt.org')) {
    $ok = $false
    try { $ok = (Test-NetConnection -ComputerName $target -Port 443 -WarningAction SilentlyContinue).TcpTestSucceeded } catch { }
    if ($ok) { Report PASS "Internet: $target" '' '' }
    else { Report FAIL "Cannot reach $target on port 443" '' 'Ask IT to allow outbound HTTPS from this server (or configure the company proxy).' }
}

# 6. Ports 80 and 443 must be free (Caddy will use them)
foreach ($port in 80, 443) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { Report PASS "Port $port is free" '' ''; continue }
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $name = $(if ($proc) { $proc.ProcessName } else { "pid $($listener.OwningProcess)" })
    if ($name -eq 'caddy') { Report PASS "Port $port is used by Caddy (already set up)" '' ''; continue }
    $fix = 'Find out with IT what uses it before stopping anything.'
    if ($name -eq 'System') { $fix = 'Usually IIS (World Wide Web Publishing Service). If nothing on this server needs IIS: Stop-Service W3SVC; Set-Service W3SVC -StartupType Disabled' }
    Report FAIL "Port $port is already in use by $name" '' $fix
}

# 7. WSL state (informational)
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if ($wsl) {
    $distros = (wsl.exe -l -q 2>$null) -replace "`0", '' | Where-Object { $_ -and $_.Trim() }
    if ($distros -match 'Ubuntu') { Report PASS 'WSL with Ubuntu is installed' ($distros -join ', ') '' }
    else { Report WARN 'WSL is present but Ubuntu is not installed yet' '' 'Continue with the guide: wsl --install -d Ubuntu-24.04 --web-download' }
} else {
    Report WARN 'WSL is not installed yet' '' 'Continue with the guide: wsl --install -d Ubuntu-24.04 --web-download'
}

Write-Host ""
if ($failures -eq 0) {
    Write-Host "RESULT: ready ($warnings warning(s)). Continue with the guide." -ForegroundColor Green
} else {
    Write-Host "RESULT: $failures problem(s) to fix first ($warnings warning(s)). See FIX lines above." -ForegroundColor Red
}
Write-Host ""
