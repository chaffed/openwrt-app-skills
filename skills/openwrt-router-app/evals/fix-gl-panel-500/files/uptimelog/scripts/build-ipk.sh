#!/bin/sh
# Build luci-app-uptimelog_<version>-r<release>_all.ipk without the OpenWrt
# SDK. The package is architecture independent (shell, Lua, JavaScript), so
# this works on any Linux or macOS machine with tar and gzip.
#
# An .ipk here is a gzipped tar of ./debian-binary, ./data.tar.gz and
# ./control.tar.gz (opkg reads both this and the SDK's ar format).
#
# Usage: scripts/build-ipk.sh [output-dir]
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PKG=luci-app-uptimelog
SRC="$ROOT/$PKG"
VERSION=$(sed -n 's/^PKG_VERSION:=//p' "$SRC/Makefile")
# UPTIMELOG_RELEASE: another release number (tests/install.test.sh makes
# a newer package of the same files to upgrade to).
RELEASE=${UPTIMELOG_RELEASE:-$(sed -n 's/^PKG_RELEASE:=//p' "$SRC/Makefile")}
OUT=${1:-"$ROOT/dist"}

export COPYFILE_DISABLE=1   # no macOS ._ files in the archives
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/data/www" "$WORK/control" "$OUT"
OUT=$(cd "$OUT" && pwd)
IPK="$OUT/${PKG}_${VERSION}-r${RELEASE}_all.ipk"

cp -R "$SRC/root/." "$WORK/data/"
[ -d "$SRC/htdocs" ] && cp -R "$SRC/htdocs/." "$WORK/data/www/"
find "$WORK/data" -type f -exec chmod 644 {} +
find "$WORK/data" -type d -exec chmod 755 {} +
chmod 755 "$WORK/data/usr/bin/uptimelog" "$WORK/data/etc/init.d/uptimelog" "$WORK/data/etc/uci-defaults/"* \
	"$WORK/data/usr/libexec/rpcd/luci.uptimelog"
# Root only: the secret's file (and the settings, to be safe).
chmod 600 "$WORK/data/etc/config/uptimelog" "$WORK/data/etc/config/uptimelog_auth"

SIZE=$(du -sk "$WORK/data" | cut -f1)
cat > "$WORK/control/control" <<CTRL
Package: $PKG
Version: ${VERSION}-r${RELEASE}
Depends: libc, luci-base
Source: https://github.com/someone/luci-app-uptimelog
SourceName: $PKG
License: MIT
Section: luci
Architecture: all
Installed-Size: $((SIZE * 1024))
Description: Uptime Log - Logs whether a host is up.
CTRL
# Files opkg keeps (as <name>-opkg beside them) when they were changed.
printf '/etc/config/uptimelog\n/etc/config/uptimelog_auth\n' > "$WORK/control/conffiles"

cat > "$WORK/control/postinst" <<'POST'
#!/bin/sh
[ -n "$IPKG_INSTROOT" ] && exit 0
for f in /etc/uci-defaults/80_uptimelog; do
	[ -f "$f" ] && ( . "$f" ) && rm -f "$f"
done
exit 0
POST
cat > "$WORK/control/prerm" <<'PRERM'
#!/bin/sh
[ -n "$IPKG_INSTROOT" ] && exit 0
/etc/init.d/uptimelog stop 2>/dev/null
/etc/init.d/uptimelog disable 2>/dev/null
exit 0
PRERM
cat > "$WORK/control/postrm" <<'POSTRM'
#!/bin/sh
[ -n "$IPKG_INSTROOT" ] && exit 0
rm -f /tmp/luci-indexcache* 2>/dev/null
rm -rf /tmp/luci-modulecache 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null
exit 0
POSTRM
chmod 755 "$WORK/control/postinst" "$WORK/control/prerm" "$WORK/control/postrm"

# GNU tar and bsdtar spell "owned by root" differently.
if tar --version 2>/dev/null | grep -q GNU; then
	TAROPTS="--owner=0 --group=0 --numeric-owner --format=gnu"
else
	TAROPTS="--uid 0 --gid 0 --numeric-owner --format=gnutar"
fi
# shellcheck disable=SC2086
( cd "$WORK/data" && tar $TAROPTS -czf ../data.tar.gz . )
# shellcheck disable=SC2086
( cd "$WORK/control" && tar $TAROPTS -czf ../control.tar.gz . )
echo "2.0" > "$WORK/debian-binary"
# shellcheck disable=SC2086
( cd "$WORK" && tar $TAROPTS -cf - ./debian-binary ./data.tar.gz ./control.tar.gz | gzip -n > "$IPK" )

echo "$IPK"
