/*
 * Every setting is offered in LuCI's Settings page, in the GL.iNet panel's
 * own form (gl.js) and accepted by the panel's Lua module (FIELDS). Read
 * from the sources, so a setting added in one place and forgotten in
 * another fails here.
 * Run: node tests/settings.test.js
 */
var fs = require('fs'), path = require('path');
var PKG = path.join(__dirname, '..', 'luci-app-pingwatch');
var read = function(p) { return fs.readFileSync(path.join(PKG, p), 'utf8'); };
var fail = 0;
function eq(got, want, name) {
	var g = JSON.stringify(got), w = JSON.stringify(want), good = g === w;
	if (!good) fail++;
	console.log((good ? 'ok   ' : 'FAIL ') + name + (good ? '' : ' (got ' + g + ', expected ' + w + ')'));
}
function all(re, text) { var out = [], m; while ((m = re.exec(text))) out.push(m[1]); return out; }
function sorted(a) { return a.slice().sort(); }

var luci = all(/option\(form\.\w+, '(\w+)'/g, read('htdocs/luci-static/resources/view/pingwatch/settings.js'))
	.filter(function(n) { return n.charAt(0) !== '_'; });
var gl = all(/\{ key: '(\w+)', type: '/g, read('htdocs/luci-static/resources/pingwatch/gl.js'))
	.filter(function(n) { return n !== 'secret'; });
var lua = all(/^    (\w+) = \{/gm, /local FIELDS = \{\n([\s\S]*?)\n\}/.exec(read('root/usr/lib/oui-httpd/rpc/pingwatch'))[1]);

eq(sorted(gl), sorted(luci), 'the GL panel form offers the same settings as LuCI');
eq(sorted(lua), sorted(luci), 'the GL panel module accepts the same settings as LuCI');
var version = /^PKG_VERSION:=(.*)$/m.exec(read('Makefile'))[1];
eq(/^VERSION=(\S+)/m.exec(read('root/usr/bin/pingwatch'))[1], version, 'the program reports the package version');
console.log(fail ? '\n' + fail + ' check(s) failed' : '\nall checks passed');
process.exit(fail ? 1 : 0);
