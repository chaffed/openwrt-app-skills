# Ping Watch

Pings a host on a schedule and keeps the results.

An OpenWrt package (`luci-app-pingwatch`) with pages in LuCI (Services → Ping Watch) and in the GL.iNet admin panel (Applications → Ping Watch). Tested on OpenWrt 23.05, the release GL.iNet firmware 4.x is built on.

## Install

Download the `.ipk` from the [latest release](https://github.com/someone/luci-app-pingwatch/releases/latest), copy it to the router and run:

```sh
opkg update
opkg install /tmp/luci-app-pingwatch_*.ipk
```

## Build

```sh
scripts/build-ipk.sh        # writes dist/luci-app-pingwatch_<version>-r<release>_all.ipk
```

No OpenWrt SDK needed: the package is architecture independent.

## License

MIT
