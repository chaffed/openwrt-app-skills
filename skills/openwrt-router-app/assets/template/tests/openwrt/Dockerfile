# OpenWrt 23.05, the release GL.iNet firmware 4.x is built on, with LuCI
# and Lua (cjson, UCI) for the GL panel module's stand-in. For the tests.
FROM openwrt/rootfs:x86-64-23.05.6
RUN mkdir -p /var/lock /var/run && opkg update && opkg install luci-light lua lua-cjson libuci-lua && rm -rf /tmp/opkg-lists
