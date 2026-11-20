# Packaging, the service, releases and the opkg feed

## Contents
1. The .ipk without the SDK
2. Control scripts
3. conffiles and upgrades
4. uci-defaults
5. procd service
6. Keeping data through firmware upgrades
7. Versions and releases
8. A signed opkg feed on GitHub Pages

## 1. The .ipk without the SDK

A package with no compiled code (shell, Lua, JS, JSON) is `Architecture: all` and can be built with tar and gzip alone. The template's `scripts/build-ipk.sh` does it. What matters:

- **Layout.** Our .ipk is an outer *gzipped tar* of `./debian-binary` (text `2.0`), `./data.tar.gz` and `./control.tar.gz`. The SDK produces an `ar` archive instead, and opkg reads both. `data` is `root/` copied to `/` plus `htdocs/` copied to `/www/`.
- **Root ownership in all three tars.** GNU tar: `--owner=0 --group=0 --numeric-owner --format=gnu`. bsdtar (macOS): `--uid 0 --gid 0 --numeric-owner --format=gnutar`. Detect which one with `tar --version | grep -q GNU`.
- **macOS:** `export COPYFILE_DISABLE=1`, or `._*` files land in the package. Use `gzip -n` for repeatable output.
- **Set modes in the build, not from the checkout.** git doesn't keep modes, so a secrets file could install world-readable. Use `chmod 644` for files and 755 for dirs, then 755 the backend, init script, uci-defaults and rpcd plugin, then **600 any config that holds a secret**.
- `Installed-Size` = `du -sk data` × 1024.
- **Relative output folder:** resolve it with `OUT=$(cd "$OUT" && pwd)` after `mkdir -p`. The script `cd`s into its work folder, and a relative path then fails in CI with `Directory nonexistent` / `Broken pipe`.
- Keep a feed-style `Makefile` (`include ../../luci.mk`, `LUCI_PKGARCH:=all`, a `conffiles` define) as the single source of `PKG_VERSION`/`PKG_RELEASE`. The build script reads both from it. The same folder can then also go into an OpenWrt feed.
- `Depends:` packages from the official feed (curl, jsonfilter, openssl-util, …) are fetched by opkg itself on a clean install. GL firmware already has most of them: curl, jsonfilter, lua 5.1 with lua-cjson, ucode, openssl.
- **Reinstalling the same version** needs `opkg install --force-reinstall x.ipk`. Better: bump `PKG_RELEASE` for every build you put on a router, so each one is an upgrade.

## 2. Control scripts

- **postinst** must run the package's uci-defaults itself, because opkg runs `/etc/uci-defaults/*` only at boot. Guard it with `[ -n "$IPKG_INSTROOT" ] && exit 0` (true during image builds), then `( . "$f" ) && rm -f "$f"`. As a result, `/etc/uci-defaults/80_<id>` is *absent* after install. That is expected, and the install test checks for it.
- **prerm:** stop and disable the service, and end any session with an external device.
- **postrm:** clear the LuCI caches (`rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache`), then `/etc/init.d/rpcd reload`. On GL firmware, reload nginx: `[ -d /usr/lib/oui-httpd/rpc ] && [ -s /var/run/nginx.pid ] && /usr/sbin/nginx -s reload`. Without these, a removed app's menu entry and ubus object stay visible until a reboot.

## 3. conffiles and upgrades

- List every `/etc/config/<file>` in `control/conffiles`, or an upgrade overwrites the user's settings.
- **The side effect:** when the user's copy differs from the package's, opkg prints `Existing conffile /etc/config/x is different from the conffile in the new package. The new conffile will be placed at /etc/config/x-opkg.` That leaves an `x-opkg` file behind on every upgrade. The settings are kept. Delete the stray copies in uci-defaults (`rm -f /etc/config/<id>-opkg …`).
- On remove, opkg prints `Not deleting modified conffile` and keeps the settings, which is what you want. Reinstalling picks them up again.
- The install test covers all of this: clean install → change settings and the secret → upgrade to release+1 → kept, still mode 600, no `-opkg` files → remove → files gone, settings kept → reinstall → settings in use.

## 4. uci-defaults

`/etc/uci-defaults/80_<id>` runs after every install *and* every upgrade, so it must be idempotent. Use it for:
- creating the `_auth` file and setting mode 600 (UCI keeps a file's mode when it rewrites it, so set the mode before a secret goes in)
- migrations: move a setting to a new file, or add a new UCI section only if it is missing (`uci -q get x.limits >/dev/null || uci set x.limits=limits`)
- deleting the `-opkg` copies
- clearing the LuCI caches and running `rpcd reload`
- registering the config with `reload_config` (section 5)
- running `nginx -s reload` on GL, then `enable` and `restart` for the service

## 5. procd service

```sh
start_service() {
	procd_open_instance
	procd_set_param command /usr/bin/<id> daemon
	procd_set_param file /etc/config/<id>   # any config change restarts it
	procd_set_param respawn 3600 10 0
	procd_set_param term_timeout 20         # time to finish a check / log out
	procd_set_param stderr 1
	procd_close_instance
}
service_triggers() { procd_add_reload_trigger <id>; }
```

- **Always register the instance, and let the daemon idle while disabled.** A `start_service` that returns early when `enabled=0` can never be re-enabled by `reload_config`: no instance exists, so the reload has nothing to restart.
- **`reload_config` only notices configs that have a checksum in `/var/run/config.md5`**, which is written at boot. A config installed later is never "changed", so the first Save & Apply after install does nothing. Fix in uci-defaults:
  ```sh
  if [ -f /var/run/config.md5 ] && ! grep -q '/var/run/config.check/<id>$' /var/run/config.md5; then
  	mkdir -p /var/run/config.check
  	uci show <id> > /var/run/config.check/<id>
  	md5sum /var/run/config.check/<id> >> /var/run/config.md5
  	rm -rf /var/run/config.check
  fi
  ```
  As a fallback, the daemon also re-reads its settings at least once a minute.
- procd debounces reload triggers. In tests, wait about 5 s after `reload_config`, not 2.
- The first `stop` may print `Command failed: ubus call service delete … (Not found)`. That is harmless.
- Prefer a procd daemon to cron. It can wait for NTP, keep a session open and catch up after a restart (see `backend.md`).

## 6. Keeping data through firmware upgrades

`/lib/upgrade/keep.d/luci-app-<id>` lists paths that sysupgrade keeps, for example `/etc/<id>/`. A reboot keeps `/etc` anyway. `/tmp` and `/var` are RAM. Neither app has tested a real firmware upgrade with keep.d yet, so say so if it matters.

## 7. Versions and releases

- The version lives in two places, held together by a test: the Makefile's `PKG_VERSION`, and `VERSION=` in the backend, which `status` reports. Grep for the old string before tagging.
- **Release flow that worked:**
  1. Push to main.
  2. Watch CI until it passes: `gh run watch <id> --exit-status`. Right after a push, find the run for the new head SHA with `gh run list`, or you'll watch the previous run.
  3. Tag and push the tag: `git tag -a vX.Y.Z -m … && git push origin vX.Y.Z`. CI builds and attaches the .ipk (`softprops/action-gh-release@v2`, `permissions: contents: write`).
  4. Download the released file with `gh release download vX.Y.Z --pattern '*.ipk'` and install *that* file on the router.

## 8. A signed opkg feed on GitHub Pages

This lets users run `opkg upgrade` instead of downloading files by hand. A working example: `github.com/chaffed/openwrt-packages`.

**Index:**
- `Packages` holds each .ipk's `control` fields, plus `Filename:`, `Size:` and `SHA256sum:`, and a blank line between packages. Read the control file from either format: `tar -xzOf x.ipk ./control.tar.gz | tar -xzOf - ./control` for ours, `ar p x.ipk control.tar.gz | …` for SDK-built ones.
- `Packages.gz` is the same file compressed with `gzip -9n`. `src/gz` feeds fetch this one.

**Signature:**
- Make it with usign (OpenWrt's signify), run inside `openwrt/rootfs:x86-64-23.05.6`, which already has it:
  ```sh
  usign -S -m Packages -s key.sec -x Packages.sig
  usign -V -m Packages -p key.pub   # check before publishing
  ```
- Make the key pair once with `usign -G -s key.sec -p key.pub`.

**Publishing workflow:**
- Triggers: push, `workflow_dispatch`, and a cron every 6 h.
- It runs `gh release download -R <repo> --pattern '*.ipk'` for each app listed in `packages.txt`, then builds and signs the index.
- The secret key comes from a repository secret, written with `umask 077` to `$RUNNER_TEMP` and deleted afterwards.
- It ends with `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`. Pages must be set to "GitHub Actions" as its source.

**Router side:**
```sh
wget -O /tmp/<name>.pub https://<owner>.github.io/<repo>/<name>.pub
opkg-key add /tmp/<name>.pub
echo 'src/gz <name> https://<owner>.github.io/<repo>' >> /etc/opkg/customfeeds.conf
opkg update && opkg install luci-app-<id>
```
- With `option check_signature` (the default) and the key missing, opkg says `Signature check failed.` and refuses the list.
- To remove the key: `rm /etc/opkg/keys/<fingerprint>`.
- busybox wget handles HTTPS to github.io.
- OpenWrt 25.x uses `apk`, not opkg, so an opkg feed doesn't serve it.

**Keeping the key:**
- Keep a backup of the secret key outside GitHub (mode 600). A repository secret cannot be read back, and a new key means every router must add the new public key.
- Never commit the secret key.
- Creating the repository, uploading the secret and publishing are outward-facing steps. Confirm them with the user, and run them one at a time.

**Distribution:** GL's own Plug-ins page lists only GL's signed feeds. There is no way to submit third-party packages to it, so your own feed is the practical route.
