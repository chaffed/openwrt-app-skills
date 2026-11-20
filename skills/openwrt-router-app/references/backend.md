# The backend (busybox shell on the router)

## Contents
1. Shape of the backend
2. The daemon: schedule, NTP, signals
3. Locking and background jobs
4. Storage
5. Secrets
6. Output for the web pages, and the ubus size limit
7. Copy to a USB drive
8. busybox, ash and ucode traps
9. Untrusted values

## 1. Shape of the backend

One POSIX `sh` script, `/usr/bin/<id>`, with subcommands:
- `check`: take one reading and store it
- `daemon`: the procd service runs this
- `status`: JSON
- `data SINCE [UNTIL]`: JSON
- `set-secret`: reads stdin
- `clear`, `export`, …

Both UIs call these subcommands, and so do the tests. Keep the measuring code ("reader") separate from storage, so that another device model can be added as another reader.

- Begin with `# shellcheck shell=dash` and lint everything with shellcheck. busybox's `local` triggers SC3043; disable it at file level if needed.
- `load_config` reads every UCI option with a default (`X=$(uci -q get app.main.x); X=${X:-default}`) and validates numbers (`int_or`).
- End with `[ "${APP_LIB:-}" = 1 ] && return 0 2>/dev/null` before the command dispatch. `APP_LIB=1 . /usr/bin/<id>` then loads the functions without running anything, which helps probes on the router and tests.
- Log with `logger -t <id>`, and also to stderr when it is a terminal. Log a failure that keeps repeating once, not on every check.

## 2. The daemon: schedule, NTP, signals

- **The router has no battery-backed clock.** Until NTP sets the time, every timestamp is wrong (a reading dated 2023 is worthless as evidence). The ntp hotplug that ships with dnsmasq creates `/var/state/dnsmasqsec` once the time is valid. Wait for that file, or for uptime ≥ 600 s:
  ```sh
  time_synced() { [ -e /var/state/dnsmasqsec ] && return 0; [ "$(uptime_s)" -ge 600 ]; }
  ```
  In containers and CI, `touch /var/state/dnsmasqsec`. A fresh CI runner has been up less than 10 minutes, so a test that doesn't do this times out.
- **Schedule on `/proc/uptime`, not wall time**, so an NTP step can neither stall the schedule nor fire a burst of checks.
- On restart, carry on from the last stored reading if it is recent, rather than checking at once.
- Re-read the settings every loop, at most a minute apart.
- Use an interruptible sleep (`sleep N & SLEEP_PID=$!; wait $SLEEP_PID`) and `trap '… kill $SLEEP_PID $CHECK_PID; cleanup; exit 0' INT TERM`, so a stop takes effect at once. Run each check in a subshell `( do_check ) &` and wait for it.
- Write the next due time to `/var/run/<id>/next` for the Overview page.
- Add a few seconds of random jitter (`awk 'BEGIN{srand(); print int(rand()*20)}'`) if many routers might hit the same server.

## 3. Locking and background jobs

- busybox `flock` exists but has **no `-w` timeout**: only `-s -x -u -n`. Use `exec 9> lockfile; flock -x 9` to wait, or `flock -n 9` to give up at once. A `mkdir lockdir` plus pid file with stale-pid recovery also works.
- **A job started from rpcd must fully detach** (`"$0" run </dev/null >/dev/null 2>&1 &`). Otherwise rpcd waits on the open stdout and the UI call hangs.
- GL's `gl-ngx-session` kills only the direct child after its timeout. A detached grandchild survives, which is how a long job started from the GL panel can finish.
- A process started with `&` over ssh dies when the session closes. Use `start-stop-daemon -S -b -x /tmp/script.sh`, with the script itself as `-x`. With `-x /bin/sh` it matches other shells and refuses to start.

## 4. Storage

- Keep data in `/etc/<id>/` on flash: it survives reboots and is listed in keep.d. `/tmp` and `/var` are RAM.
- **Daily files:** `readings/YYYY-MM-DD.csv` with a header line. After the day ends, gzip it (`gzip -f`). Delete days older than `history_days`. Read the files back with `gzip -dc`. That's a few MB for 90 days at 5-minute checks.
- **A reading that could not be taken is stored as `failed` with a reason**, such as `no_answer`, `login_refused` or `timeout`, never as empty, zero or good. The UIs explain each reason.
- Store running counters as the *change* since the previous good reading, and detect a device restart (counter reset). Store a slowly changing table, such as a line-up or inventory, only when a row actually changes. One that was written at every check grew by 115 KB a day on a flapping line.
- Clean text from outside before storing it: `tr -d '\000-\037",\\<>' | cut -c1-120`. That keeps CSV and HTML safe and makes the pages simpler.
- Dates: compare `YYYYMMDD` as numbers (`[ "$a" -lt "$b" ]`). busybox `test \<` is unreliable. `date -d "@$epoch" +%Y%m%d` works in busybox.

## 5. Secrets

- Store the secret only in `/etc/config/<id>_auth`, mode 600, because LuCI's `form.Map` sends the whole `<id>` config to the browser. `status` reports `secret_set: true/false`, never the value.
- **Never on a command line**: any process can read `/proc/*/cmdline`. From rpcd, pass it on stdin (`printf '%s\n' "$s" | app set-secret`) or in the environment (`APP_SECRET="$s" app test`). GL's `ngx.pipe` has neither, so the Lua module writes it with UCI itself (see `glinet-panel.md`).
- A "test connection with what is typed, before saving" button with the GL panel: the backend makes a root-only temp file (`app test-input` → `mktemp /var/run/<id>/test-input.XXXXXX`). The Lua module writes the typed values into it, and the backend reads the file, deletes it and accepts only paths matching that exact pattern.
- Getting a secret onto the router before any UI exists, without it appearing in chat or shell history:
  ```sh
  ssh -t router 'read -rsp "Secret: " p; echo; uci set app_auth.main.secret="$p"; uci commit app_auth; chmod 600 /etc/config/app_auth'
  ```
  The user types it.

## 6. Output for the web pages, and the ubus size limit

- Print JSON with small helpers (`json_str` escapes `\` and `"` and strips control characters; `json_num` prints `null` when the value isn't a number). For history, send the CSV text as a single JSON string and parse it in the browser. That is far cheaper than building objects in shell.
- **A ubus reply fails somewhere between 1 and 2 MB.** It was measured with a throwaway rpcd plugin that printed N bytes; a 7-day request of 2.8 MB failed. Any history method must take `since`/`until` (and a limit), and the page asks in pieces (about 250 rows ≈ 360 KB each) and joins them. Long reports reduce each piece as it arrives.
- Accept `since`/`until` as integers only, and clamp them.

## 7. Copy to a USB drive

- GL firmware mounts drives at `/tmp/mountd/disk1_part1`, and `/tmp` is RAM. **When the drive is unplugged, its mount point is just a RAM folder**, and writing there fills RAM and fakes success. Before creating anything, check `on_drive`:
  1. Resolve the nearest existing folder with `cd && pwd -P`.
  2. Find its mount in `/proc/mounts` (longest prefix match).
  3. Refuse `/`, `/rom` and `/overlay`, and refuse internal filesystem types (`rootfs overlay squashfs jffs2 ubifs tmpfs ramfs devtmpfs proc sysfs …`).

  The Modem Health backend has the full version: `mount_of`, `internal_fs`, `existing_dir`, `on_drive`, `list_drives`.
- Append only new rows. Find the last timestamp in the drive's file with `tail -c 4096 | tail -n 1`, so a drive that was unplugged catches up at the next check.
- Write big files, such as a report, once a day. Write them to `name.part`, then `mv`, so a half-written file never replaces a good one. Skip the write when the md5 is unchanged.
- Record the copy's state (ok / nodrive / error and the reason) for the Settings page, and offer the mounted drives as suggestions.

## 8. busybox, ash and ucode traps

| Missing or different | Use instead |
|---|---|
| `stat` | `ls -l f \| cut -c1-10` for the mode |
| `diff` | awk, or compare `md5sum` |
| `pkill`, `rev`, `od` (`od` is absent on GL) | `kill $(cat pidfile)`, awk |
| `sleep 0.5` (invalid number) | whole seconds |
| `flock -w` | `flock -x` / `flock -n` |
| `test "$a" \< "$b"` | numeric compare of YYYYMMDD |
| `date +%s%3N` (no milliseconds) | `ucode -e 'let c = clock(); print(c[0] * 1000 + int(c[1] / 1000000));'` (ucode is on every 23.05 image) |
| `var=$(func)` when `func` sets globals | call `func` directly and have it set a result variable; a command substitution runs in a subshell, so its variables are lost |

- curl `--max-time` applies to each transfer, not to the whole command. With `-k` it accepts a device's self-signed certificate. Map its exit codes to reasons: 6/7 unreachable, 28 timeout, 35/60 TLS.
- awk reading a state file with `FNR==NR` breaks when that file is empty or missing, because awk then treats the main input as the first file. Read the state file with `while ((getline line < f) > 0)` in `BEGIN`.
- An unquoted `${x:+…}` used in curl header arguments word-splits. Use a plain if/else.
- `openssl dgst -sha256 -hmac KEY` is available when `openssl-util` is installed (3.0.x on GL 4.10). Check it against a known test vector before relying on it.
- GL Lua 5.1 uses 32-bit integers (see `glinet-panel.md`). Shell arithmetic on the router is 64-bit.
- Long greps over large files on the router are slow, and an ssh command that times out keeps running there. Copy files to your machine (`scp -O`) and analyse them there, and kill anything you left running.

## 9. Untrusted values

Treat every UCI value as hostile in a script that runs as root. Values that have been tried in tests:
- `url="http://x -o /tmp/pwned http://y"`
- `file=/etc/shadow`
- `host="-c1;reboot"`
- `iface="wan;id"`

Whitelist characters (`case $v in *[!A-Za-z0-9._-]*) v=default ;; esac`), reject a leading `-`, always quote variables, and fall back to the default.
