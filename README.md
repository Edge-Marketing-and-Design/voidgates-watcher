# VoidGates Watcher

A lightweight log-monitoring daemon that detects repeated 404 requests from abusive IPs and automatically blocks them via the Cloudflare API — globally or per-zone.

Ideal for protecting Lightsail, Apache, or Nginx servers from brute-force scanners, exploit probes, and bad actors targeting non-existent files.

---

## ✨ Features

- 🛡 Detects excessive 404s from a single IP within a time window
- 🔒 Automatically blocks the IP via Cloudflare's Access Rules API
- 📅 Supports automatic unblocking after a configurable duration
- ♻️ Scheduled cleanup of expired blocks
- 🌐 Supports **global (account-wide)** or **zone-specific** blocking
- 🧩 Environment-based configuration — easy to customize and deploy
- 📦 Designed for server environments like Bitnami Lightsail stacks

---

## 🚀 Installation

```bash
npm install -g @edgedev/voidgates-watcher
```

Or clone for development:

```bash
git clone https://github.com/Edge-Marketing-and-Design/voidgates-watcher.git
cd voidgates-watcher
npm install
```

---

## ⚙️ Setup

The **first time you run** the watcher, it will prompt you to select a location for your config file and fill out all required environment variables. A `voidgates.env` file will be created for you.

To run the watcher:

```bash
npx voidgates-watcher
```

To rerun the setup process at any time:

```bash
npx voidgates-watcher setup
```

> ⚠️ If you've installed it globally and your system exposes global binaries, you may also be able to run `voidgates-watcher` instead of `npx voidgates-watcher`.

To run continuously with `pm2`:

```bash
pm2 start $(which voidgates-watcher) --name voidgates
```

### 🛠 Example `.env` Configuration

```env
# Cloudflare API Token must include the following permissions:
# - Scope: Account, Permission: Account Firewall Access Rules, Access Level: Edit
# - Scope: Account, Permission: Account Settings, Access Level: Read
# - Scope: Zone,    Permission: Zone,                      Access Level: Read
# - Scope: Zone,    Permission: Firewall Services,         Access Level: Edit
CF_API_TOKEN=your_cloudflare_token

# Cloudflare Account ID (required for global blocks)
CF_ACCOUNT_ID=your_account_id

# Optional: Cloudflare Zone ID (if set, IPs are blocked only in that zone)
# Leave blank to apply blocks globally (all zones under your account)
VOIDGATES_ZONE=

# Access log path (Apache or Nginx)
LOG_PATH=/opt/bitnami/apache2/logs/access_log

# === 404-Based Blocking Settings ===

# Number of 404s from a single IP before blocking
404_BLOCK_THRESHOLD=10

# Time window (seconds) to trigger threshold
404_BLOCK_INTERVAL_SECONDS=60

# How long (in seconds) the IP should remain blocked
# Leave blank or 0 for permanent block
404_BLOCK_DURATION_SECONDS=3600

# === Path-Based Abuse Blocking Settings ===

# Number of times an IP can hit the same path before being blocked
PATH_BLOCK_THRESHOLD=15

# Time window (in seconds) in which the path threshold must be exceeded
PATH_BLOCK_INTERVAL_SECONDS=60

# How long (in seconds) the IP should remain blocked for path-based blocks
# Leave blank or set to 0 to block permanently
PATH_BLOCK_DURATION_SECONDS=1800

# === Cleanup ===

# How often (in seconds) to check for and remove expired blocks
CLEANUP_INTERVAL_SECONDS=300

# If true, the script will simulate blocks without calling the Cloudflare API
# Useful for testing and development
DRY_RUN=true
```

---

## 🧹 Expired Block Cleanup

A scheduled cleanup function removes expired blocks automatically based on the block duration.
Only blocks added by this tool (identified by the note prefix) will be removed.

---

## 🔍 Important: Real Visitor IPs

Your server must be configured to **trust the `CF-Connecting-IP` header** from Cloudflare to avoid blocking Cloudflare proxy IPs instead of real attackers.

Please follow the official guide to enable real IP support:  
https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers/#connecting-ip

### Apache example:

```apache
LoadModule remoteip_module modules/mod_remoteip.so
RemoteIPHeader CF-Connecting-IP
```

### Nginx example:

```nginx
real_ip_header CF-Connecting-IP;
# Add each Cloudflare IP range
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 104.16.0.0/13;
# ... more ranges ...
```

🔗 Full list of Cloudflare IP ranges:  
https://www.cloudflare.com/ips/

---

## 🧪 Testing Locally

Use a mock or sample log file by setting:

```env
LOG_PATH=./test/access_log.txt
```

Then append test entries like:

```
192.0.2.123 - - [09/Jul/2025:13:22:00 +0000] "GET /notreal.php HTTP/1.1" 404 512
```

---

## 📄 Notes Format in Cloudflare

Blocked IPs are tagged with a timestamp note for cleanup:

```
VoidGates 404 Abuse - 2025-07-09T15:32:00Z
VoidGates Path Abuse - 2025-07-09T15:32:00Z
```

---

## 🔧 PM2 & Node Setup (Recommended for Production)

### Step 1: Install NVM (Node Version Manager)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

### Step 2: Load NVM into current shell

```bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
```

### Step 3: Install latest LTS version of Node.js (includes npm)

```bash
nvm install --lts
```

### Step 4: Install PM2 globally using npm

```bash
npm install -g pm2
```

### Step 5: Start your app with PM2

```bash
pm2 start $(which voidgates-watcher) --name voidgates
```

### Step 6: Enable PM2 to start on system boot

```bash
pm2 startup
```

👉 Run the `sudo` command that it prints, e.g.: sudo env PATH=$PATH:/home/bitnami/.nvm/versions/node/vXX.X.X/bin pm2 startup systemd -u bitnami --hp /home/bitnami


### Step 7: Save your PM2 process list

```bash
pm2 save
```

---

## 🧑‍💻 License

MIT
