# Test rigs and CI

The template ships three tests that run as they are: `tests/settings.test.js`, `tests/install.test.sh` and `tests/web.test.js`. This file explains the rigs behind them and how to extend them. Modem Health's `tests/` folder (`github.com/chaffed/luci-app-modemhealth`) has the bigger versions: a backend test against a fake device, a history generator, screenshots and a sample report.

## Contents
1. OpenWrt in Docker
2. The LuCI container and the browser
3. The GL panel stand-ins
4. Backend tests against a fake device
5. Test data
6. The secrecy and hostile-data checks
7. CI (GitHub Actions)
8. Habits that caught real bugs

## 1. OpenWrt in Docker

- Image: `openwrt/rootfs:x86-64-23.05.6`, the release GL firmware 4.x is built on.
  - The plain `x86` tag is a different, 32-bit image.
  - There is no arm64 manifest (`no matching manifest for linux/arm64/v8`). On Apple-silicon Macs, pass `--platform linux/amd64` to both `docker build` and `docker run`; it runs under Rosetta.
  - One older arm image (`armvirt-64-22.03.5`) has amd64 metadata but aarch64 binaries. Avoid it.
- `mkdir -p /var/lock /var/run` before `opkg update` in a plain container.
- procd, ubus, rpcd and uhttpd need PID 1: `docker run -d … /sbin/init`, then wait until the web server answers before using `docker exec`.
- Fake NTP sync: `mkdir -p /var/state && touch /var/state/dnsmasqsec`.
- To reach a server on the host (a fake device): `--add-host modem:host-gateway`, or `host.docker.internal`.
- **Bind mounts:**
  - Docker Desktop doesn't share the macOS temp folder (`$TMPDIR`, `/var/folders`); a mount from there shows up empty. Put test output in a git-ignored `.test-out/` inside the repo.
  - On Linux CI, files the container writes are owned by root and the host can't delete them (`EACCES`). Have the container remove them (`rm -rf /out/*`) before it is removed, and wrap the host's cleanup in try/catch.
  - Copying a mode-600 file out for the host to read fails in CI, because the runner isn't root. Copy it with `cat src > dst`, so the copy gets default permissions.
- **Docker Desktop answers pings to any IP address**, even TEST-NET's 192.0.2.1, in under a millisecond. To make a network check fail, use a name that can't resolve (`nohost.invalid`) or a closed port on the host, not an "unreachable" IP.
- Ports: use unusual fixed ports, bind them to `127.0.0.1:` only, run `docker rm -f <name>` before starting, and don't run two rigs that share ports at the same time. `port is already allocated` means a leftover container.
- Kernel rate limits for bandwidth tests: `--cap-add NET_ADMIN`, `opkg install tc-tiny`, `tc qdisc add dev eth0 root tbf rate 20mbit burst 64kb latency 300ms`.
- Fake USB drive: `-v vol:/mnt/usb`, and `:ro` for a read-only one.
- Run the install test against the package as users get it: build the .ipk, build a second copy with release+1, then go through install → upgrade → remove → reinstall on a clean image (the template's `install.test.sh`).

## 2. The LuCI container and the browser

- Image: `FROM openwrt/rootfs:x86-64-23.05.6` + `opkg install luci-light lua lua-cjson libuci-lua`. That gives uhttpd, rpcd and the bootstrap theme, the same LuCI that GL installs, plus Lua for the GL stand-in.
- Start it with `/sbin/init` and `-p 127.0.0.1:<port>:80`, and mount the package folder read-only. Copy `root/.` to `/` and `htdocs/.` to `/www/`, chmod the executables, run the uci-defaults file, and set a root password (`printf 'pw\npw\n' | passwd root`).
- Log in through the real form: fill `input[name=luci_username]` and `input[name=luci_password]`, then press Enter. With curl: `curl -c cj -d 'luci_username=root&luci_password=pw' http://127.0.0.1:<port>/cgi-bin/luci/` returns 302 and `sysauth_http`.
- Playwright without downloading browsers: `npm install --no-save playwright-core`, then `chromium.launch({ channel: 'chrome' })` to use the system Chrome. Allow an override with `executablePath` from an environment variable. GitHub's ubuntu runner has Chrome.
- Playwright pitfalls:
  - LuCI's login page answers 403, so attach `pageerror`/`console` listeners only after logging in.
  - A reply cut off by navigation never settles `res.text()`. Wrap it in `Promise.race` with a timeout.
  - Polling pages never reach `networkidle`. Wait for a selector.
  - Save & Apply takes several seconds (rollback confirm). Poll UCI for up to about 60 s.
- LuCI selectors:
  - A field: `[id="widget.cbid.<config>.<section>.<option>"]`; a select's id ends with the option name.
  - A flag: `.cbi-value[data-name="enabled"] input[type=checkbox]`.
  - A combo box: `.cbi-dropdown`, then `.create-item-input` + Enter.
  - The buttons: `.cbi-page-actions .cbi-button-save` and `.cbi-button-apply`.
- Screenshots: take them in light and dark, and *look at them*. Crop tall pages before viewing, or they are scaled down until unreadable. Headless Chrome won't lay out narrower than about 500 px; test phone widths in an iframe inside a test page.
- `APP_KEEP=1` (in the template) leaves the container running for a look by hand.

## 3. The GL panel stand-ins

`tests/gl/panel.html` and `tests/gl/rpc.lua` (see `glinet-panel.md` §9) are served by the same LuCI container: `/www/gl/panel.html`, and `/www/cgi-bin/gl-rpc` with mode 755. The browser test opens `/gl/panel.html`, finds the iframe and drives it like a user. To be sure the stand-in is close to the real panel, the stand-in:
- refuses arguments the way the real validator does
- offers only GL's three `ngx.pipe` methods, with no stdin or environment
- rejects results that carry `err_code`/`err_msg`
- encodes empty tables as `[]`

## 4. Backend tests against a fake device

When the app reads another device, run the real backend in the container against a fake device on the host:
- The fake is a Python `http.server`, over TLS if the device uses it. It replays captured, redacted replies and checks requests with the real algorithm (signatures, cookies).
- **It enforces the real device's rules**: session expiry and what an expired session returns, ordering rules, log size, and that a login writes a log entry.
- `/_control/set?k=v` and `/_control/reset` endpoints script scenarios: wrong password, unreachable, session dropped, device restart (uptime and counters reset), counter growth, log overwrite.
- Each scenario asserts on the stored files and on `status`. After every scenario, check the secret is absent from files, `logread` and output.
- When the fake and the client disagree, settle it from the device's own code or a real capture, never by bending the client to match the fake. The fake's first run found a bug in the fake itself.

See `device-protocols.md` for capturing the replies.

## 5. Test data

- Write a generator (`tests/gen.js` in Modem Health) that builds days of history in the backend's exact layout. Include outages, restarts, failed checks, gzipped past days, hostile markup in text fields, and a sibling app's results file if the app reads one. Use it for UI tests, browser rigs, screenshots and the sample report, so real user data never reaches the repo.
- Copy the router's real data folder into the container once, before calling a UI done. Keep it in scratch only and never commit it. Real data shows states the fixtures never had (unusual status strings, a channel "Not Locked", bars that merge on a long axis). Delete the copy afterwards.

## 6. The secrecy and hostile-data checks

- Use a secret full of quoting characters, such as `Pa ss,w"o'r$d\`1<b>`. Save it through each UI, then check:
  - UCI holds it exactly
  - the field comes back empty after a reload
  - no browser reply contains it
  - it never appeared as a command argument (the stand-in's spawn log)
  - stored files, `logread` and command output don't contain it

  Search for the literal value, not the word "password", which also matches script text and folder names.
- Put `<img src=x onerror=…>` and `<script>` into data fields and settings, and check nothing runs on any page: LuCI, the GL panel, and a standalone report.

## 7. CI (GitHub Actions)

One job, on push to main, on PRs and on `v*` tags:
1. shellcheck
2. JS syntax
3. Lua syntax (`luac5.1 -p`)
4. `json.tool` on every JSON file
5. node unit tests
6. the Lua module test
7. the backend test (Docker)
8. `npm install --no-save playwright-core` and the browser tests, uploading screenshots as artifacts
9. build the .ipk
10. the install test
11. upload the .ipk; on a tag, publish the release

Docker and Chrome are on `ubuntu-latest` already.

- CI runs only on main and on PRs. Open a *draft* PR early to get CI running, and mark it ready after the hardware checks.
- `gh` inside a `while read` loop eats the loop's stdin. Give it `</dev/null`.
- In Python test scripts that build shell commands, a `%` in `date +%s` clashes with `%` formatting. Write `%%s` only in strings that are actually `%`-formatted.
- Waiting in Claude Code: a foreground `sleep` is blocked. Use `gh pr checks <n> --watch`, `gh run watch <id> --exit-status`, or a background command.

## 8. Habits that caught real bugs

- Assert on rendered text, not only on "no script errors". The `%`-format bug and the "unknown" reason in the template were both invisible to error checks.
- Make each new test fail first: take the fix out, or break a copy of the module, and see the test fail with the same error the real device gave.
- After a fix in the template or a generator, regenerate and rerun from clean; don't patch the generated copy.
- Hold two implementations of the same rule together with one shared fixture, for example awk in the backend and JS in the page.
