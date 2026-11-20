---
name: openwrt-router-app
description: Build, extend, test and ship router apps for OpenWrt and GL.iNet routers - a luci-app-* package with a busybox shell backend, a procd scheduler, LuCI pages, a page in the GL.iNet admin panel (firmware 4.x), a .ipk built without the SDK, Docker/browser test rigs and a signed opkg feed. Use this whenever the user wants to make a new router app or plugin, add a page/setting/feature to a luci-app, show something in the GL.iNet admin panel, write an rpcd plugin, ACL, menu.d entry, uci-defaults or procd init script, build or publish an .ipk / opkg feed, test router code in an OpenWrt container, or monitor a device (modem, NAS, UPS) from the router - even if they don't say "LuCI" or "OpenWrt" and just mention their GL.iNet or OpenWrt router.
---

# OpenWrt / GL.iNet router apps

This skill holds what was learned the hard way building two complete router apps (ISPy, a speed-test monitor, and Modem Health, a cable-modem monitor), both running on a GL-BE9300 with GL firmware 4.10.1 (OpenWrt 23.05). Most of it is undocumented behaviour of LuCI, busybox, opkg and the GL.iNet panel. The worked examples are public: `github.com/chaffed/luci-app-ispy` and `github.com/chaffed/luci-app-modemhealth`. Read their files when you need a fuller implementation than the template has, such as charts, reports, a USB copy, an external device or translations.

## The shape of an app

One package, `luci-app-<id>`, architecture `all`. It holds no compiled code, so it builds anywhere with tar and gzip.

| Part | File (in the package) | Job |
|---|---|---|
| Backend | `root/usr/bin/<id>` | busybox `sh`: check, daemon, status, data, set-secret. Prints JSON for the UIs |
| Scheduler | `root/etc/init.d/<id>` | procd service that always runs and idles while disabled |
| Settings | `root/etc/config/<id>` (+ `<id>_auth`, mode 600, for secrets) | UCI |
| First run | `root/etc/uci-defaults/80_<id>` | idempotent migrations and cache reloads. Run by postinst |
| LuCI API | `root/usr/libexec/rpcd/luci.<id>` + `root/usr/share/rpcd/acl.d/luci-app-<id>.json` | ubus object for LuCI |
| LuCI pages | `root/usr/share/luci/menu.d/…json`, `htdocs/luci-static/resources/view/<id>/*.js`, shared code in `resources/<id>/common.js` | client-side JS views |
| GL panel page | `htdocs/views/gl-sdk4-ui-<id>.common.js`, `root/usr/share/oui/menu.d/<id>.json`, `htdocs/i18n/gl-sdk4-ui-<id>.<lang>.json` | Vue shell with an iframe running `resources/<id>/gl.js` |
| GL panel API | `root/usr/lib/oui-httpd/rpc/<id>` (Lua) + `root/usr/share/gl-validator.d/<id>.lua` | the panel's RPC. rpcd is not running on stock GL firmware |
| Keep data | `root/lib/upgrade/keep.d/luci-app-<id>` | the data folder survives a firmware upgrade |
| Build | `scripts/build-ipk.sh`, `Makefile` (feed-style, the version source) | .ipk without the SDK |
| Tests/CI | `tests/…`, `.github/workflows/build.yml` | container, browser and install tests. A tag publishes a release |

Two web UIs talk to one backend. LuCI calls rpcd, and rpcd runs the backend. The GL panel calls its Lua module, and that module runs the backend. **GL users mostly never open LuCI**, which is not installed on GL firmware by default and lives on port 8080 once installed. If the user has a GL router, plan the GL panel page from the start.

## Starting a new app

1. Ask what the app measures or does, and who reads its output. If the output is evidence for an ISP or regulator, read `references/evidence-and-process.md` before designing storage.
2. Generate the skeleton. It builds, installs and passes its tests as it is:
   ```sh
   sh <skill-dir>/scripts/new-app.sh <id> "<Title>" "<One sentence.>" <github-owner> <target-dir>
   ```
   `<id>` is lowercase letters and digits. The result is a small "check something on a schedule" app with every part in the table above: a write-only secret, Overview and Settings pages in LuCI and in the GL panel, an install/upgrade/remove test, a browser test of both UIs, and CI.
3. Replace `do_measure` in the backend with the real check. Keep its contract: on success set `RESULT` and return 0, on failure set `FAIL_REASON` and return 1. Then change `READINGS_HEADER`, the Overview table and the settings.
4. Run the tests (below) after each step, not at the end.
5. If the app talks to another device (modem, NAS, camera), read `references/device-protocols.md` first. Capture real replies and build a fake device before writing the client.

Adding to an existing app: read its CLAUDE.md, then work from the checklists below.

## Checklists for common changes

**A new setting** goes in three places, which `tests/settings.test.js` keeps in step:
- LuCI `view/<id>/settings.js`
- the GL form in `gl.js` (`sections()`)
- `FIELDS` in the Lua module, with a validator function

Give it a default in `/etc/config/<id>` and read it in the backend's `load_config` with a fallback. If it can hold commas, quotes or spaces, the GL method that stores it must be exempted in `gl-validator.d` and check the value itself.

**A new backend method for the UIs** needs four things:
- add it to rpcd's `list` JSON and `call` case
- put it under `read` or `write` in the ACL (anything that changes state or contacts a device is `write`)
- add `M.<method>` in the Lua module
- if the GL panel polls it, give it a name containing `get`, `load` or `check`. The panel writes every other call to the system log.

**A new LuCI API used by a view**, for example `uci`, `dom` or `ui.showModal`, also needs a stand-in in `gl.js`, or the GL page breaks.

**Text shown on a page** must be passed as an array child, `E('td', {}, [ text ])`. A bare string is set as innerHTML. Any `.format()` string writes a literal percent sign as `%%`.

**A secret** (password, token) must never be in argv, logs, stored files, command output or any browser reply. It lives only in `/etc/config/<id>_auth` (600). It reaches the backend on stdin or in the environment from rpcd. The Lua module writes it with UCI directly, because GL's `ngx.pipe` has no stdin or environment. The test greps for it with a value full of quoting characters.

**A release** needs four steps:
- bump `PKG_VERSION` in the Makefile and `VERSION=` in the backend
- push, and wait for CI to go green
- tag `vX.Y.Z` and push the tag; CI attaches the .ipk to a GitHub release
- install that released file on the router

To reach users through `opkg upgrade`, publish through a signed feed (`references/packaging.md`).

## The traps that cost the most time

Each one is explained, with its fix, in the reference named in brackets.

- opkg does not run uci-defaults on a live system: postinst must. Every `/etc/config` file goes in `conffiles`, and upgrades then leave `<name>-opkg` copies behind to delete. [packaging]
- `reload_config` (LuCI's Save & Apply) ignores a config installed after boot until it is registered in `/var/run/config.md5`. A `start_service` that returns early when disabled can never be re-enabled. [packaging]
- busybox:
  - has no `stat`, `diff`, `pkill`, `rev`, `od`, or fractional `sleep`
  - `flock` has no `-w`
  - `test \<` is unreliable
  - `date` has no milliseconds
  - a variable set inside `$(...)` is lost [backend]
- No battery-backed clock: never store a reading before NTP has set the time (`/var/state/dnsmasqsec`). Schedule on `/proc/uptime`. [backend]
- A ubus reply fails somewhere between 1 and 2 MB: page history in pieces. [backend]
- An unplugged USB drive's mount point is a RAM folder: check `on_drive` before writing. [backend]
- LuCI "Save" only stages a change; "Save & Apply" commits it after a rollback wait of several seconds. Menus are cached in `/tmp/luci-indexcache*`. [luci]
- GL panel:
  - its `ngx.pipe` is not OpenResty's
  - its validator refuses commas and most punctuation
  - it rejects any result carrying `err_code`/`err_msg`
  - nginx caches the Lua module until `nginx -s reload`
  - Lua is 5.1 with 32-bit integers, so use `%.0f`, not `%d` [glinet-panel]
- Docker on Apple-silicon Macs:
  - pass `--platform linux/amd64`
  - put bind mounts under the repo (`.test-out/`), never `$TMPDIR`
  - Docker Desktop answers pings to *any* IP, so use a `.invalid` name to make a check fail [testing]

## How to verify (in this order)

1. **Static checks:** shellcheck (`shell=dash`), `node -e "new Function(src)"` on every view, `luac -p` on the Lua files, `json.tool` on every JSON file, and `node tests/settings.test.js`.
2. **Container:** `sh tests/install.test.sh` installs, upgrades, removes and reinstalls on clean OpenWrt 23.05. A backend test can run the real script against a fake device.
3. **Browser:** `node tests/web.test.js` (needs `npm install --no-save playwright-core` and Chrome) logs in to LuCI in a container and drives both UIs. The GL panel is the stand-in `tests/gl/panel.html` plus `tests/gl/rpc.lua`, which runs the real Lua module under the panel's rules. Check rendered text, not only "no errors".
4. **Real router**, if the user has one: check first whether you can reach it (`ssh -o BatchMode=yes -o ConnectTimeout=8 root@<router> 'cat /tmp/sysinfo/model'`) before saying it is untested. Copy files with `scp -O`, since there's no SFTP server. Treat the router as production (see `references/evidence-and-process.md`): ask before rebooting it, reinstalling cleanly or doing anything else disruptive.

When a check seems to need the user's browser or password, build a rig that does it instead of handing it back. Leave only the final look on the real router to the user, and say plainly what was and wasn't verified on real hardware.

## References

Read the one for the part you're touching. Each is self-contained.

- `references/packaging.md`:
  - .ipk layout and build script
  - control scripts, conffiles, uci-defaults, keep.d
  - procd service, config.md5
  - versions, releases, the signed opkg feed on GitHub Pages
- `references/backend.md`:
  - the busybox shell backend: daemon loop, NTP wait, locking
  - daily CSV storage, USB drive copy
  - secrets, JSON output, ubus size limit
  - busybox and ucode traps
- `references/luci.md`:
  - menu.d, ACL and rpcd plugin
  - view and form patterns, the write-only secret field
  - `format`/`E()` traps, caches, Save vs Save & Apply
- `references/glinet-panel.md`:
  - how the GL.iNet panel loads views, menus, i18n and Lua RPC
  - its validator, logging, `$request` and `ngx.pipe`
  - the iframe and `gl.js` pattern, theme sync, testing on the router
- `references/testing.md`:
  - OpenWrt Docker rigs, the LuCI container, the GL stand-ins
  - Playwright, fake device servers, the secrecy test
  - CI workflow and its pitfalls
- `references/device-protocols.md`:
  - reverse-engineering a device's web login from its own JavaScript
  - capturing and redacting fixtures, measuring session and log rules
  - building a fake device
- `references/evidence-and-process.md`:
  - standards for results that serve as evidence: failed stays failed, sourced thresholds
  - privacy in public artifacts
  - working safely on the user's router and network
