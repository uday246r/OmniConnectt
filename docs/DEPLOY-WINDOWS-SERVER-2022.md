# Deploying OmniConnect on Windows Server 2022: step by step

This guide takes you from "I have VPN and Remote Desktop access" to "the platform is live at
`https://<your domain>`". Follow it top to bottom. You don't need to know Podman, Linux or nginx: every
command is given in full, and every step tells you how to check it worked.

**How long:** about 2–3 hours of your time. Most of it is waiting for downloads and builds. Allow a day
for your manager/IT to complete their part (Part 3).

**What you end up with**

```
 Internet ──HTTPS──► Windows Server 2022
                      ├─ Caddy (Windows service)  ← HTTPS certificate from Let's Encrypt, renews by itself
                      └─ Ubuntu 24.04 (WSL2)      ← Linux built into Windows
                          └─ Podman (rootful)      ← runs the containers; starts them again at boot
                              ├─ nginx            ← serves the app, only reachable through Caddy
                              ├─ AuthService, LeadService, Customer360Service, ProductsService
                              └─ PostgreSQL       ← the 4 databases, data kept on this server
```

**Why Linux inside Windows?** The platform's services run in Linux containers. Windows Server 2022 runs
those through **WSL2**, a Linux layer built into Windows. Inside it, **Podman** runs the containers. Podman
is a daemonless container engine that reads the same images and `compose.yml` as Docker. It runs
**rootful** (as root): that is what lets it start the platform again after a reboot and keep each
visitor's address. The release scripts ask for your Ubuntu password (`sudo`) when they need it.
**Caddy** is a small Windows program. It holds the HTTPS
certificate and passes each visitor's real address on to the platform, which the login protection and
the audit log depend on.

> **Two kinds of window.** Every command says where to paste it:
> - **PowerShell (Admin)**: on the server, right-click **Start** → **Windows PowerShell (Admin)** (or
>   **Terminal (Admin)**). Its title bar says *Administrator*.
> - **Ubuntu**: the Linux terminal. Open it from **Start** → **Ubuntu 24.04**, or type
>   `wsl -d Ubuntu-24.04` in PowerShell. Its prompt looks like `you@SERVER:~$`.
>
> To paste in either window, **right-click**.

> **Passwords: type them yourself, only where asked.** Never paste a password into a chat, an email or
> a document. That includes the VPN/Remote Desktop password. If one has already been shared somewhere,
> ask your manager to reset it after the deployment.

---

## Part 1: On your laptop: connect to the server

### 1.1 Install the VPN client
1. Open <https://www.fortinet.com/support/product-downloads#vpn>.
2. Under **FortiClient VPN** (the free, VPN-only edition), download the **Windows** installer and run it.
   Accept the defaults.
3. Open **FortiClient VPN** → **Configure VPN**. Fill in the connection details your manager gave you
   (connection name, remote gateway, port). Save.
4. Choose the connection, type **your** username and password, and press **Connect**. If MFA is on,
   approve the prompt. The status turns to *Connected*.

### 1.2 Open Remote Desktop, with your laptop's drive shared
You will copy a few files from your laptop to the server, so share your C: drive with the session:

1. Press **Win + R**, type `mstsc`, press **Enter**.
2. Click **Show Options**.
3. On the **General** tab, enter the server's **Computer** name or IP (from your manager).
4. On **Local Resources**, click **More…** under *Local devices and resources*, tick **Drives → Windows (C:)**,
   and click **OK**.
5. Click **Connect** and sign in with the credentials from your manager. Type them yourself.

On the server, your laptop's drive now appears as `\\tsclient\C`.

### 1.3 Copy the Windows helper scripts to the server
The repository is private, so the server can't download these on its own yet. Your laptop already has them.

In **PowerShell (Admin)** on the **server**, run this. Replace `Ashok-windows` if your laptop's user
folder is named differently.

```powershell
New-Item -ItemType Directory -Force C:\OmniConnect\scripts | Out-Null
Copy-Item \\tsclient\C\Users\Ashok-windows\Downloads\OmniConnectt\deploy\windows\*.ps1 C:\OmniConnect\scripts\
Get-ChildItem C:\OmniConnect\scripts
```

**Check:** `check-server.ps1`, `setup-windows.ps1` and `status.ps1` are listed.

---

## Part 2: Pre-flight check (5 minutes)

In **PowerShell (Admin)** on the server:

```powershell
powershell -ExecutionPolicy Bypass -File C:\OmniConnect\scripts\check-server.ps1
```

The check changes nothing. Each line is **PASS**, **WARN** or **FAIL**, and every FAIL comes with a **FIX** line.

| If you see | Do this |
|---|---|
| *Not running as Administrator* | Close the window and open **PowerShell (Admin)** as described above. |
| *needs updates for WSL2* | **Settings → Update & Security → Check for updates**, install everything, reboot, run the check again. |
| *Port 80/443 is already in use by System* | That is usually IIS. If nothing on this server uses IIS (ask IT): `Stop-Service W3SVC; Set-Service W3SVC -StartupType Disabled` |
| *Cannot reach … on port 443* | The server can't reach the internet. Send the output to IT (Part 3). |
| *Not enough memory / disk* | Ask IT: at least **8 GB RAM** and **40 GB free** on C:. |
| *Cannot confirm nested virtualization yet* (WARN) | Fine for now. Part 4 will tell you for certain. |

Save the output. You'll paste it into the message in Part 3 if something needs IT.

---

## Part 3: What your manager/IT must do (send this now, carry on meanwhile)

Copy this message, fill in the `<…>`, and send it to your manager/IT:

> We're deploying OmniConnect on **<server name / IP>**. Could you please arrange:
> 1. **DNS:** an **A record** for **<omniconnect.company.com>** pointing to the **public IP address** at
>    which this server is reachable from the internet.
> 2. **Inbound firewall/NAT:** allow TCP **80** and **443** from the internet to this server. Port 80 is
>    needed for the free HTTPS certificate (Let's Encrypt) and redirects to 443.
> 3. **Outbound internet** from the server over HTTPS: github.com, mcr.microsoft.com, Docker Hub,
>    registry.npmjs.org, deb.nodesource.com, archive.ubuntu.com, acme-v02.api.letsencrypt.org.
> 4. **If the server is a virtual machine:** enable **nested virtualization** for it (Hyper-V:
>    `Set-VMProcessor -VMName <vm> -ExposeVirtualizationExtensions $true` with the VM off; VMware:
>    *Expose hardware assisted virtualization to the guest OS*). WSL2 needs it.
> 5. Confirm that a **Let's Encrypt** certificate is acceptable for this domain. If not, we need a
>    certificate and its private key from you.
> 6. Optional: **SMTP** details (host, port, user, password, from-address) for password-reset and
>    invitation emails, and the **Customer 360 CRM** URL and client credentials.
> 7. Where should we keep the platform's **secrets file** and **copies of the nightly database backup**?
>    For example, the company password vault and a file share.
>
> Pre-flight check output from the server: <paste>

You can do Parts 4–8 before IT is done. Only Part 9 (HTTPS) needs items 1 and 2.

---

## Part 4: Install Linux (WSL2 + Ubuntu): 15 minutes plus one reboot

### 4.1 Install
In **PowerShell (Admin)**:

```powershell
wsl --update --web-download
wsl --install -d Ubuntu-24.04 --web-download
```

When it says a restart is required:

```powershell
Restart-Computer
```

Wait about 2 minutes, then reconnect with Remote Desktop (VPN still on).

### 4.2 Finish Ubuntu's setup
After the reboot an **Ubuntu** window usually opens by itself. If it doesn't, open **Start → Ubuntu 24.04**.
It asks for:

- **a new UNIX username**: for example `omni` (lowercase, no spaces);
- **a password**: choose one and **store it in the password vault**. You will need it for `sudo` commands.

**Check:** in **PowerShell (Admin)**:

```powershell
wsl -l -v
```

You should see `Ubuntu-24.04   Running   2`. The **2** is what matters.

| Problem | Fix |
|---|---|
| Error **0x80370102**, or "virtualization is not enabled" | Nested virtualization is off. Part 3, item 4 (IT). After IT enables it: `Restart-Computer`, then run 4.1 again. |
| "The Windows Subsystem for Linux optional component is not enabled" | `dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart`, then `dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart`, then `Restart-Computer` and run 4.1 again. |
| VERSION shows **1** | `wsl --set-version Ubuntu-24.04 2` |

### 4.3 Give Linux enough memory
By default WSL2 uses half of the server's RAM. To give it more, run this in **PowerShell (Admin)**:

```powershell
$ramGb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$wslGb = [math]::Max(4, $ramGb - 2)
"[wsl2]`nmemory=${wslGb}GB`nswap=4GB" | Set-Content -Encoding ascii "$env:USERPROFILE\.wslconfig"
wsl --shutdown
Get-Content "$env:USERPROFILE\.wslconfig"
```

This leaves 2 GB for Windows.

---

## Part 5: Prepare Ubuntu: 20 minutes

Everything in this part is pasted into the **Ubuntu** window. A command starting with `sudo` asks for
the Ubuntu password from 4.2. As you type it, nothing appears on screen; that is normal.

### 5.1 Let Ubuntu start services (Podman's) by itself

```bash
printf '[boot]\nsystemd=true\n' | sudo tee /etc/wsl.conf
```

Then in **PowerShell (Admin)**:

```powershell
wsl --shutdown
```

Reopen **Ubuntu** (Start → Ubuntu 24.04).

**Check** (in Ubuntu): `systemctl is-system-running` prints `running` or `degraded`. Both are fine.

### 5.2 Updates and basic tools

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y ca-certificates curl git jq openssl gnupg
```

### 5.3 Podman
Podman and the Compose tool it drives come from Ubuntu's own packages. Ubuntu 24.04 ships Podman 4.9:

```bash
sudo apt-get install -y podman docker-compose-v2
sudo ln -sf /usr/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose
sudo systemctl enable --now podman.socket podman-restart.service
```

- `podman.socket` lets the Compose tool talk to Podman.
- `podman-restart.service` starts the platform's containers again after every reboot.

**Check:**

```bash
sudo podman run --rm docker.io/library/hello-world
sudo podman compose version
systemctl is-enabled podman-restart.service
```

You should see:
- "Hello from Docker!" from the test image;
- a compose version (`2.x`), possibly after a line starting `>>>> Executing external compose provider`, which is normal;
- `enabled`.

> Always use **`sudo podman …`**, never plain `podman`, for the platform. Plain `podman` is a separate
> per-user ("rootless") store in which the platform does not exist.

### 5.4 Node.js 24 and pnpm (to build the frontend)

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
echo 'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0' >> ~/.bashrc && source ~/.bashrc
node -v
```

**Check:** `node -v` prints `v24.x`.

### 5.5 Get the code (signing in to GitHub yourself)
The repository is private, so sign in with **your own** GitHub account that has access to `uday246r/OmniConnectt`:

```bash
(type -p wget >/dev/null || sudo apt-get install -y wget)
sudo mkdir -p -m 755 /etc/apt/keyrings
wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt-get update && sudo apt-get install -y gh
gh auth login
```

Answer the questions: **GitHub.com** → **HTTPS** → *Authenticate Git with your GitHub credentials?* **Yes**
→ **Login with a web browser**. It shows a one-time code. Open <https://github.com/login/device> in the
server's browser (Edge), enter the code, and sign in to GitHub yourself.

Then:

```bash
gh repo clone uday246r/OmniConnectt ~/OmniConnectt
sudo mkdir -p /srv/omniconnect /srv/omniconnect-backups
sudo chown "$USER:$USER" /srv/omniconnect /srv/omniconnect-backups
ls ~/OmniConnectt
```

**Check:** you see `Backend`, `Frontend`, `deploy` and `docs`.

> Keep the code in your Linux home folder (`~`) as above, never under `/mnt/c/...`. Builds there are
> very slow and the release scripts depend on Linux file features.

---

## Part 6: Configure: 5 minutes

Still in **Ubuntu**:

```bash
cd ~/OmniConnectt/deploy
scripts/init-env.sh
```

It asks for:
- **the domain**, e.g. `omniconnect.company.com`, exactly as in the DNS request;
- **an email** for certificate notices, e.g. your team's mailbox;
- **the Customer 360 CRM URL and credentials**, if you have them. Otherwise press **Enter** to skip and
  add them later (Part 11).

It then generates every secret the platform needs (signing keys, service keys, the database password)
and writes them to `deploy/.env` and `deploy/env/*.env`. Nobody has to type or share them.

**Keep a safe copy.** Without these files, the database backups can't be used by a new installation:

```bash
tar czf ~/omniconnect-secrets.tgz -C ~/OmniConnectt/deploy .env env/auth.env env/lead.env env/customer360.env env/products.env
explorer.exe .
```

The second command opens your Linux home folder in Windows Explorer. Move `omniconnect-secrets.tgz` to
wherever your manager said secrets are kept (Part 3, item 7), then delete it from the home folder.
**Never email it.**

---

## Part 7: Build: 20–40 minutes, mostly waiting

### 7.1 Backend images

```bash
cd ~/OmniConnectt/deploy
scripts/build-images.sh
```

It asks for your Ubuntu password, then builds with Podman's own builder.

**Check:** it ends with four `✔ localhost/omniconnect/…` lines (auth, lead, customer360, products).

### 7.2 Frontend release

```bash
cd ~/OmniConnectt/Frontend
pnpm install --frozen-lockfile
pnpm release
```

This runs every check and test first (several minutes), then builds. **Check:** it ends with
`✔ Release <id>` and an `archive` line, e.g. `release/20261006.101500-e85fc37cfc40.tar.gz`.

---

## Part 8: First deploy: 10 minutes

```bash
cd ~/OmniConnectt/deploy
scripts/deploy.sh ../Frontend/release/*.tar.gz
```

It asks for your Ubuntu password (Podman runs as root). What happens:
1. The database starts.
2. Each service creates its tables.
3. Everything starts.
4. The three apps register themselves.
5. 18 automatic checks run.

**Check:** the last lines are `✔ All smoke checks passed.` and `✔ Release … is live.`

Now get the **one-time administrator password**. It is printed once, on this first start only:

```bash
sudo podman compose logs auth | grep -A2 "Seeded the bootstrap"
```

It shows `Email: superadmin@omniconnect.com` and `Password: …`. You will change it at first sign-in
in Part 10.

---

## Part 9: HTTPS and start-at-boot (Windows side): 10 minutes

In **PowerShell (Admin)**, with your own domain and email:

```powershell
powershell -ExecutionPolicy Bypass -File C:\OmniConnect\scripts\setup-windows.ps1 -Domain omniconnect.company.com -Email it-team@company.com
```

It works through these steps, printing each one:
1. **Checks** that the platform answers inside Ubuntu and from Windows.
2. **Downloads Caddy** from its official release and verifies the download's fingerprint.
3. **Configures HTTPS** for your domain.
4. **Installs Caddy as a Windows service**, so it starts with the server.
5. **Opens ports 80 and 443** in Windows Firewall.
6. **Creates two scheduled tasks.** One keeps the platform running from boot, even with nobody logged
   in. The other makes the **nightly database backup** at 02:00.

   Windows shows a **password prompt for your Windows account** here. Type your own Windows password; the
   task scheduler needs it to run while nobody is logged in.
7. **Tries HTTPS.** If IT has finished Part 3 (DNS plus ports 80/443), you'll see
   `https://<domain> answers with a valid certificate`. If not, that's expected: Caddy keeps retrying by
   itself and the certificate appears within minutes of IT finishing.

**Check:**

```powershell
powershell -ExecutionPolicy Bypass -File C:\OmniConnect\scripts\status.ps1 -Domain omniconnect.company.com
```

Every line should be **[ OK ]** once DNS and the firewall are in place.

---

## Part 10: First sign-in and a real test: 10 minutes

On **your laptop** (VPN not needed if the domain is public), open `https://omniconnect.company.com`.

1. **Sign in** with `superadmin@omniconnect.com` and the one-time password from Part 8.
2. **Choose a new strong password** when asked, and store it in the password vault.
3. **Check the apps:** **Settings (gear) → Applications** lists Lead Management, Customer 360 and
   Products & Marketplace, all **Healthy**.
4. **Create a product:** **Products & Marketplace → Categories → Add Category**, then
   **Sub-categories → Add**, then **Products → Add Product**.
5. **Create a lead against it:** **Lead Management → Create Lead**. Your new category and product are in
   the picker. Create a test lead, and it appears under **View Leads**.
6. **Check visitors' real addresses come through.** Open **Audit Logs**. Your sign-in row's address must be
   **your laptop's public IP**, not `127.0.0.1` or `172.30.0.x`. If it shows one of those, see
   *"Every user shows the same IP"* in Part 12. The login protection and the audit trail depend on this.

### Reboot test (do it once)
In **PowerShell (Admin)**: `Restart-Computer`. **Don't reconnect.** Wait 3 minutes, then open the site
from your laptop. It should load. Then reconnect and run `status.ps1`; every line should be **[ OK ]**.

If the site is down after the reboot, look at `sudo systemctl status podman-restart.service` in Ubuntu.
It must be *active (exited)*, and `sudo podman ps` must list the containers.

**🎉 The platform is live.**

---

## Part 11: Day-to-day operations

All commands in this part run in **Ubuntu**, from `~/OmniConnectt/deploy`, unless marked otherwise.

### Is everything OK?
In **PowerShell (Admin)**: `powershell -ExecutionPolicy Bypass -File C:\OmniConnect\scripts\status.ps1 -Domain omniconnect.company.com`

In **Ubuntu**:
- `sudo podman compose ps` shows every service as *healthy*.
- `sudo podman compose logs --tail 100 auth` shows a service's recent log (`auth`, `lead`, `c360`, `products`, `web`, `db`).

### Backups
- **Automatic:** every night at 02:00, into `/srv/omniconnect-backups/<date-time>/`, kept for 14 days.
- **By hand:** `scripts/backup-db.sh`.
- **From Windows Explorer:** `\\wsl.localhost\Ubuntu-24.04\srv\omniconnect-backups`.
- **Copy them off the server regularly** (Part 3, item 7). A backup on the same machine doesn't survive
  losing the machine.
- **Restore one database:** `scripts/restore-db.sh /srv/omniconnect-backups/<date-time>/<db>.dump <db>`,
  where `<db>` is `auth_service`, `lead_service`, `customer360_service` or `products_service`. It asks you
  to type the name to confirm; everything since that backup is replaced.

### Releasing a new version
1. **Get the new code:** `cd ~/OmniConnectt && git pull`.
2. **If backend code changed:** `cd deploy && scripts/build-images.sh`.
3. **Build the frontend release.** Every frontend app you changed must have a higher `version` in its
   `package.json`; the build tells you if you forgot. Then:

   ```bash
   cd ~/OmniConnectt/Frontend && pnpm install --frozen-lockfile && pnpm release
   ```

4. **Deploy it:**

   ```bash
   cd ~/OmniConnectt/deploy && scripts/deploy.sh ../Frontend/release/<new id>.tar.gz
   ```

   If only the frontend changed, add `--frontend-only` at the end: then nothing restarts.

Users with the app open keep working. They're offered a reload the next time they open the updated app.

### Something wrong after a release?
- **Roll back one app:** `scripts/rollback.sh lead`. This is instant.
- **Roll back the whole frontend:** `scripts/rollback.sh --release <previous id>` (the ids are in
  `ls /srv/omniconnect/releases`).
- **Release history:** `scripts/promote.sh --list`.

### Maintenance mode
In the app: **Settings → Applications → (app) → status: Maintenance**, with a message. Users see the
maintenance page. Administrators, and roles granted **Applications → MaintenanceBypass**, can still
open the app to check a fix.

### Add the CRM, email or Google sign-in later
Edit the file in Ubuntu with `nano` (save with **Ctrl+O**, **Enter**, exit with **Ctrl+X**), then apply
the change:

| What | File | Settings | Apply with |
|---|---|---|---|
| Customer 360 CRM | `nano env/customer360.env` | `CrmApi__*` | `sudo podman compose up -d c360` |
| Email | `nano env/auth.env` | `Smtp__*` | `sudo podman compose up -d auth` |
| Google sign-in | `nano env/auth.env` | `Google__ClientId`, `Google__AllowedDomains` | `sudo podman compose up -d auth` |

For Google sign-in, also add `https://<domain>` as an Authorized JavaScript origin in Google Cloud.

### The HTTPS certificate
Caddy renews it by itself about 30 days before expiry, and `status.ps1` shows the date. Nothing to do.

---

## Part 12: Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Site doesn't load at all from outside | **DNS:** `Resolve-DnsName omniconnect.company.com` (PowerShell) must show the server's public IP. **Ports:** IT must forward 80/443. **Caddy:** `status.ps1`. |
| Browser shows a certificate warning | Caddy could not get the certificate yet, usually because DNS or port 80 isn't ready. Caddy retries by itself. To see why, open PowerShell (Admin) and run `Stop-Service OmniConnectCaddy; C:\OmniConnect\caddy\caddy.exe run --config C:\OmniConnect\caddy\Caddyfile`, read the error, then press **Ctrl+C** and run `Start-Service OmniConnectCaddy`. |
| "502 Bad Gateway" | Caddy works, but the platform inside Ubuntu isn't answering. In Ubuntu: `cd ~/OmniConnectt/deploy && sudo podman compose ps`, then `sudo podman compose up -d`. |
| After a reboot, nothing works until someone logs in | The keep-alive task didn't start. In Task Scheduler, open **OmniConnect - keep platform running**: it must be *Running*, with "Run whether user is logged on or not". Run `setup-windows.ps1` again. Ask IT whether a policy blocks "log on as a batch job" for your account. |
| White page in the browser | Press **Ctrl+Shift+R**. If it persists, the browser console (F12) names the failing file; `sudo podman compose logs web`. |
| `deploy.sh`: "already published with different content" | Code changed but the app's `version` wasn't bumped. Bump it in the app's `package.json` and run `pnpm release` again. |
| `deploy.sh`: "Migrations for … failed" | Nothing was switched, so users are unaffected. `sudo podman compose logs <service>` shows why. Usually the database isn't running: `sudo podman compose up -d db`. |
| A service keeps restarting | `sudo podman compose logs --tail 200 <service>`. A missing or wrong value in `env/<service>.env` is named at the top. |
| "Cannot connect to the Docker daemon at unix:///run/podman/podman.sock" | Podman's socket is off: `sudo systemctl enable --now podman.socket`. If systemd isn't running, redo 5.1. |
| `podman compose`: "looking up compose provider failed" | `sudo apt-get install -y docker-compose-v2 && sudo ln -sf /usr/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose` |
| A service stays "starting" and never becomes healthy | Podman runs health checks through systemd timers. Check `systemctl is-system-running` (5.1), then `sudo podman healthcheck run omniconnect-auth-1` (or `-lead-1` and so on). |
| Every user shows the same IP (`127.0.0.1` or `172.30.0.x`) in Audit Logs | Check `deploy/.env` has `EDGE_PROXY=local-proxy` and `PUBLIC_BIND=127.0.0.1`, then `sudo podman compose up -d web`. If it persists, send `sudo podman compose logs --tail 50 web` to the developers: the address nginx sees must be added to `deploy/nginx/edge/local-proxy.conf`. |
| Disk is filling up | `sudo podman system df`. Unused images: `sudo podman image prune -f`. Old frontend versions: `scripts/gc.sh`, then `scripts/gc.sh --apply`. |

**What this setup does and does not cover:**
- It is **one server**. If the server fails, the site is down until it is restored, so keep the off-server
  backups and the secrets file safe.
- **Updates.** Windows updates reboot the server: the platform comes back by itself (the reboot test proves
  it), so schedule updates outside working hours. Update Ubuntu monthly:
  `sudo apt-get update && sudo apt-get -y upgrade`.

More detail on how releases work: [RUNBOOK-RELEASE.md](RUNBOOK-RELEASE.md).
