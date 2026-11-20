# __TITLE__ - __DESC__
# Drop this directory into an OpenWrt/LuCI feed (feeds/luci/applications/)
# or build a standalone .ipk with scripts/build-ipk.sh.
#
# SPDX-License-Identifier: MIT

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-__APP__
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

LUCI_TITLE:=__TITLE__ - __DESC__
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

define Package/luci-app-__APP__/conffiles
/etc/config/__APP__
/etc/config/__APP___auth
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
