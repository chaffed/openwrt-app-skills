# Uptime Log

Logs whether a host is up.

An OpenWrt package (`luci-app-uptimelog`) with pages in LuCI (Services → Uptime Log) and in the GL.iNet admin panel (Applications → Uptime Log). Tested on OpenWrt 23.05, the release GL.iNet firmware 4.x is built on.

## Install

Download the `.ipk` from the [latest release](https://github.com/someone/luci-app-uptimelog/releases/latest), copy it to the router and run:

```sh
opkg update
opkg install /tmp/luci-app-uptimelog_*.ipk
```

## Build

```sh
scripts/build-ipk.sh        # writes dist/luci-app-uptimelog_<version>-r<release>_all.ipk
```

No OpenWrt SDK needed: the package is architecture independent.

## License

MIT
