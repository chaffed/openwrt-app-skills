# luci-app-__APP__

__TITLE__: __DESC__ An OpenWrt package with pages in LuCI and in the GL.iNet admin panel (firmware 4.x).

## Working on this repo

- Built from the `openwrt-router-app` skill's template; that skill's references hold the LuCI, GL.iNet panel, packaging and testing rules this app follows. Load it before touching the web UI, the GL panel, the package scripts or the tests.
- A reading that could not be taken is stored as *failed* with its reason, never as an empty or good reading.
- The secret lives only in `/etc/config/__APP___auth` (mode 600). It must never reach stored files, logs, command output or the browser; `tests/web.test.js` checks with a secret full of quoting characters.
- A new setting goes in three places: LuCI `settings.js`, the GL form in `gl.js` (`sections()`), and `FIELDS` in `root/usr/lib/oui-httpd/rpc/__APP__`. `node tests/settings.test.js` checks.
- Strings passed to `.format()` write a literal percent as `%%`.
- Tests: `node tests/settings.test.js`, `node tests/web.test.js` (Docker + Chrome + `npm install --no-save playwright-core`), `sh tests/install.test.sh` (Docker). Test output goes to `.test-out/` because Docker Desktop on macOS doesn't share the system temp folder.
- Release: bump `PKG_VERSION` in the Makefile and `VERSION` in the backend, tag `vX.Y.Z`, push the tag; CI attaches the .ipk to a GitHub release.
