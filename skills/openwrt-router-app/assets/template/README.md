# __TITLE__

__DESC__

An OpenWrt package (`luci-app-__APP__`) with pages in LuCI (Services → __TITLE__) and in the GL.iNet admin panel (Applications → __TITLE__). Tested on OpenWrt 23.05, the release GL.iNet firmware 4.x is built on.

## Install

Download the `.ipk` from the [latest release](https://github.com/__OWNER__/luci-app-__APP__/releases/latest), copy it to the router and run:

```sh
opkg update
opkg install /tmp/luci-app-__APP___*.ipk
```

## Build

```sh
scripts/build-ipk.sh        # writes dist/luci-app-__APP___<version>-r<release>_all.ipk
```

No OpenWrt SDK needed: the package is architecture independent.

## License

MIT
