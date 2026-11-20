# Ping Watch - Pings a host on a schedule and keeps the results.
# Drop this directory into an OpenWrt/LuCI feed (feeds/luci/applications/)
# or build a standalone .ipk with scripts/build-ipk.sh.
#
# SPDX-License-Identifier: MIT

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-pingwatch
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

LUCI_TITLE:=Ping Watch - Pings a host on a schedule and keeps the results.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

define Package/luci-app-pingwatch/conffiles
/etc/config/pingwatch
/etc/config/pingwatch_auth
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
