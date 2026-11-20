#!/bin/sh
# The package as people get it: the .ipk, installed with opkg on a clean
# OpenWrt 23.05 (a container), then upgraded to a newer release, removed and
# installed again. Settings, the secret and the history must come through
# all of it. Needs Docker.
#
# Run: sh tests/install.test.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/.test-out/install"   # inside the repo: Docker Desktop on macOS does not share the system temp folder
rm -rf "$OUT"
mkdir -p "$OUT"
VERSION=$(sed -n 's/^PKG_VERSION:=//p' "$ROOT/luci-app-pingwatch/Makefile")
RELEASE=$(sed -n 's/^PKG_RELEASE:=//p' "$ROOT/luci-app-pingwatch/Makefile")
sh "$ROOT/scripts/build-ipk.sh" "$OUT" >/dev/null
PINGWATCH_RELEASE=$((RELEASE + 1)) sh "$ROOT/scripts/build-ipk.sh" "$OUT" >/dev/null

docker run --rm --platform linux/amd64 -v "$OUT:/dist:ro" -e VERSION="$VERSION" -e RELEASE="$RELEASE" openwrt/rootfs:x86-64-23.05.6 sh -c '
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }
check() { if eval "$1" >/dev/null 2>&1; then ok "$2"; else bad "$2"; fi; }
this=/dist/luci-app-pingwatch_${VERSION}-r${RELEASE}_all.ipk
newer=/dist/luci-app-pingwatch_${VERSION}-r$((RELEASE + 1))_all.ipk
mode() { ls -l "$1" | cut -c1-10; }   # busybox has no stat
mkdir -p /var/lock /var/run
opkg update >/dev/null 2>&1 || { echo "FAIL opkg update (no network?)"; exit 1; }

opkg install "$this" >/tmp/install.log 2>&1 || { cat /tmp/install.log; echo "FAIL the package does not install"; exit 1; }
check "opkg list-installed | grep -q \"^luci-app-pingwatch - ${VERSION}-r${RELEASE}\$\"" "clean install: ${VERSION}-r${RELEASE} installs with its dependencies"
check "[ \"\$(pingwatch status | jsonfilter -e @.version)\" = \"$VERSION\" ]" "clean install: the program says it is $VERSION"
check "[ \"\$(mode /etc/config/pingwatch_auth)\" = -rw------- ]" "clean install: the secret file is readable by root only"
check "ls /etc/rc.d/ | grep -q pingwatch" "clean install: the scheduler is set to start with the router"
check "[ ! -e /etc/uci-defaults/80_pingwatch ]" "clean install: the first-run script ran"
check "[ -s /usr/share/luci/menu.d/luci-app-pingwatch.json ] && [ -s /usr/share/rpcd/acl.d/luci-app-pingwatch.json ] && [ -x /usr/libexec/rpcd/luci.pingwatch ]" "clean install: LuCI menu, permissions and rpcd plugin are in place"
check "[ -s /www/views/gl-sdk4-ui-pingwatch.common.js ] && [ -s /usr/share/oui/menu.d/pingwatch.json ] && [ -s /usr/lib/oui-httpd/rpc/pingwatch ]" "clean install: the GL.iNet panel files are in place"
check "[ \"\$(pingwatch status | jsonfilter -e @.secret_set)\" = false ]" "clean install: no secret yet"
uci set pingwatch.main.target=nohost.invalid   # not an address: Docker Desktop answers pings to any IP
uci commit pingwatch
pingwatch check >/dev/null 2>&1
check "grep -q \",failed,no_answer,\" /etc/pingwatch/readings/*.csv" "a check that gets no answer is stored as failed, with its reason"

uci set pingwatch.main.interval=15
uci commit pingwatch
echo "s3cret pass" | pingwatch set-secret >/dev/null
before=$(cat /etc/pingwatch/readings/*.csv | md5sum)
kept() {
	[ "$(uci -q get pingwatch.main.interval)" = 15 ] && [ "$(uci -q get pingwatch_auth.main.secret)" = "s3cret pass" ] &&
	[ "$(cat /etc/pingwatch/readings/*.csv | md5sum)" = "$before" ] && [ "$(mode /etc/config/pingwatch_auth)" = -rw------- ]
}

opkg install "$newer" >/tmp/upgrade.log 2>&1 || cat /tmp/upgrade.log
check "opkg list-installed | grep -q \"^luci-app-pingwatch - ${VERSION}-r$((RELEASE + 1))\$\"" "upgrade: a newer release installs over it"
check kept "upgrade: settings, secret and history are kept; the secret file stays root only"
check "! ls /etc/config/ | grep -q -- -opkg" "upgrade: no stray -opkg copies of the settings are left"
check "ls /etc/rc.d/ | grep -q pingwatch" "upgrade: the scheduler is still set to start"

opkg remove luci-app-pingwatch >/tmp/remove.log 2>&1 || cat /tmp/remove.log
check "[ ! -e /usr/bin/pingwatch ] && [ ! -e /www/views/gl-sdk4-ui-pingwatch.common.js ] && ! ls /etc/rc.d/ | grep -q pingwatch" "remove: the program, the scheduler and the pages are gone"
check "[ -s /etc/config/pingwatch_auth ] && ls /etc/pingwatch/readings/*.csv" "remove: settings, secret and history stay on the router"
opkg install "$this" >/tmp/again.log 2>&1 || cat /tmp/again.log
check kept "install again: picks up the kept settings, secret and history"

[ "$fail" = 0 ] && echo && echo "all checks passed"
[ "$fail" = 0 ] || { echo; echo "$fail check(s) failed"; exit 1; }
'
