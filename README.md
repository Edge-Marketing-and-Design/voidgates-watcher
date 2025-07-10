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
npm install -g voidgates-watcher
```

Or clone for development:

```bash
git clone https://github.com/your-username/voidgates-watcher.git
cd voidgates-watcher
npm install
```

---

## ⚙️ Setup

Create a `.env` file in the root directory or set environment variables directly.

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

# Number of 404s from a single IP before blocking
BLOCK_THRESHOLD=10

# Time window (seconds) to trigger threshold
BLOCK_INTERVAL_SECONDS=60

# How long (in seconds) to keep the IP blocked
# Leave blank or 0 for permanent block
BLOCK_DURATION_SECONDS=3600

# How often (in seconds) to run cleanup of expired blocks
CLEANUP_INTERVAL_SECONDS=300

# Useful for testing and development
DRY_RUN=true
```

---

## 🛠 Usage

Run the watcher:

```bash
voidgates-watcher
```

To run continuously (recommended), use a process manager like `pm2` or `systemd`:

```bash
pm2 start voidgates-watcher
```

---

## 🧹 Expired Block Cleanup

A scheduled cleanup function removes expired blocks automatically based on the `BLOCK_DURATION_SECONDS`. Only blocks added by this tool (identified by the note `VoidGates Detection - <timestamp>`) will be removed.

---

## 📄 Notes Format in Cloudflare

Blocked IPs are tagged with:

```
VoidGates Detection - 2025-07-09T15:32:00Z
```

This timestamp is used to track expiration and clean up expired entries.

---

## 🧪 Testing Locally

Use a mock or sample log file by setting:

```env
LOG_PATH=./test/access_log.txt
```

Then tail the file or append test entries like:

```
192.0.2.123 - - [09/Jul/2025:13:22:00 +0000] "GET /notreal.php HTTP/1.1" 404 512
```

---

## 🧑‍💻 License

MIT

---
