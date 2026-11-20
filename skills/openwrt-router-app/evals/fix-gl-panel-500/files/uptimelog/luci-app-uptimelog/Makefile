# Uptime Log - Logs whether a host is up.
# Drop this directory into an OpenWrt/LuCI feed (feeds/luci/applications/)
# or build a standalone .ipk with scripts/build-ipk.sh.
#
# SPDX-License-Identifier: MIT

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-uptimelog
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

LUCI_TITLE:=Uptime Log - Logs whether a host is up.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

define Package/luci-app-uptimelog/conffiles
/etc/config/uptimelog
/etc/config/uptimelog_auth
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
