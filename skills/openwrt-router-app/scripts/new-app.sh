#!/bin/sh
# Make a new OpenWrt router app from the skill's template.
#
#   new-app.sh <id> "<Title>" "<one-sentence description>" <github-owner> <target-dir>
#
#   id      lowercase letters and digits, starting with a letter (it names
#           the package luci-app-<id>, the UCI config, the backend
#           /usr/bin/<id>, the rpcd object luci.<id> and the GL panel view)
#
# The result builds, installs and passes its tests as it is; replace the
# example check (do_measure in the backend) with the app's own.
set -eu

[ $# -eq 5 ] || { sed -n '2,10p' "$0" >&2; exit 2; }
ID=$1 TITLE=$2 DESC=$3 OWNER=$4 DEST=$5
case $ID in [a-z]*) ;; *) echo "id must start with a lowercase letter" >&2; exit 2 ;; esac
case $ID in *[!a-z0-9]*) echo "id: lowercase letters and digits only" >&2; exit 2 ;; esac
[ ${#ID} -le 24 ] || { echo "id: at most 24 characters" >&2; exit 2; }
# They land in JSON, Lua and HTML text as well as JavaScript strings:
# apostrophes are escaped where needed, these characters are refused.
# shellcheck disable=SC1003
case "$TITLE$DESC" in *'|'*|*'\'*|*'"'*|*'<'*|*'>'*|*'
'*) echo "title and description may not contain | \\ \" < > or a line break" >&2; exit 2 ;; esac
[ ! -e "$DEST" ] || [ -z "$(ls -A "$DEST" 2>/dev/null)" ] || { echo "$DEST is not empty" >&2; exit 2; }

HERE=$(cd "$(dirname "$0")/.." && pwd)
TEMPLATE="$HERE/assets/template"
ENV=$(printf '%s' "$ID" | tr 'a-z' 'A-Z')
# sed replacement text: escape & (the only special left, | is the delimiter)
esc() { printf '%s' "$1" | sed 's/&/\\&/g'; }
# __TITLEJS__ and __DESCJS__ sit inside single-quoted JavaScript strings:
# an apostrophe there becomes \' (written \\' in sed replacement text).
jsesc() { esc "$1" | sed "s/'/\\\\\\\\'/g"; }
T=$(esc "$TITLE") D=$(esc "$DESC") O=$(esc "$OWNER")
TJ=$(jsesc "$TITLE") DJ=$(jsesc "$DESC")

mkdir -p "$DEST"
DEST=$(cd "$DEST" && pwd)
( cd "$TEMPLATE" && find . -type f ) | while read -r f; do
	out="$DEST/$(printf '%s' "${f#./}" | sed "s|__APP__|$ID|g")"
	mkdir -p "$(dirname "$out")"
	sed -e "s|__APPENV__|$ENV|g" -e "s|__APP__|$ID|g" -e "s|__TITLEJS__|$TJ|g" -e "s|__DESCJS__|$DJ|g" \
		-e "s|__TITLE__|$T|g" -e "s|__DESC__|$D|g" -e "s|__OWNER__|$O|g" "$TEMPLATE/$f" > "$out"
done
chmod 755 "$DEST/luci-app-$ID/root/usr/bin/$ID" "$DEST/luci-app-$ID/root/etc/init.d/$ID" \
	"$DEST/luci-app-$ID/root/etc/uci-defaults/80_$ID" "$DEST/luci-app-$ID/root/usr/libexec/rpcd/luci.$ID" \
	"$DEST/scripts/build-ipk.sh" "$DEST/tests/install.test.sh" "$DEST/tests/gl/rpc.lua"
chmod 600 "$DEST/luci-app-$ID/root/etc/config/$ID" "$DEST/luci-app-$ID/root/etc/config/${ID}_auth"
if grep -rn '__[A-Z]*__' "$DEST" >/dev/null 2>&1; then
	echo "placeholders left:" >&2; grep -rn '__[A-Z]*__' "$DEST" >&2; exit 1
fi
echo "made luci-app-$ID in $DEST"
