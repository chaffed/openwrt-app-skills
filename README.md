# OpenWrt router app skills

A [Claude Code](https://claude.com/claude-code) skill for building apps for OpenWrt and GL.iNet routers: a `luci-app-*` package with a busybox shell backend, a procd scheduler, LuCI pages, a page in the GL.iNet admin panel (firmware 4.x), an `.ipk` built without the OpenWrt SDK, Docker and browser test rigs, and a signed opkg feed.

It comes from building two complete apps and holds what their code and docs don't show: the undocumented GL.iNet panel interface, busybox and opkg traps, and how to test all of it without touching a real router. Both apps run on a GL-BE9300 (GL firmware 4.10.1, OpenWrt 23.05).

- [luci-app-ispy](https://github.com/chaffed/luci-app-ispy): scheduled speed tests and a report for the ISP
- [luci-app-modemhealth](https://github.com/chaffed/luci-app-modemhealth): cable modem signal, errors and outages

## Install

In Claude Code:

```
/plugin marketplace add chaffed/openwrt-app-skills
/plugin install openwrt-app-skills@openwrt-app-skills
```

The skill (`openwrt-router-app`) loads by itself when you ask for router work, for example "make an app for my GL.iNet router that…".

## What's inside

```
skills/openwrt-router-app/
  SKILL.md                     the map of an app, checklists, the worst traps, how to verify
  references/                  packaging · backend · luci · glinet-panel · testing ·
                               device-protocols · evidence-and-process
  scripts/new-app.sh           generate a new app from the template
  assets/template/             a small working app: backend, procd service, LuCI and GL
                               panel pages, write-only secret, build script, install test,
                               browser test of both UIs, CI
```

Make a new app without Claude:

```sh
sh skills/openwrt-router-app/scripts/new-app.sh pingwatch "Ping Watch" "Pings a host on a schedule." your-github-name ./pingwatch
cd pingwatch
sh tests/install.test.sh                                    # Docker
npm install --no-save playwright-core && node tests/web.test.js   # Docker + Chrome
scripts/build-ipk.sh
```

## Caveats

The GL.iNet panel interface is undocumented and was learned from firmware 4.10.1. A firmware update may change it; the LuCI pages keep working if it does. OpenWrt 25.x uses `apk` instead of `opkg` and isn't covered yet.

## License

MIT
