'use strict';
'require baseclass';
'require rpc';

/*
 * Ping Watch - what the LuCI views and the GL.iNet panel page share.
 * The calls go to the rpcd object luci.pingwatch in LuCI; in the GL panel,
 * gl.js stands in for 'rpc' and sends them to the panel's Lua module.
 *
 * Strings passed to .format(): LuCI's String.prototype.format reads a "%"
 * followed by a space or one of "b c o q t m u x X j" as a conversion, so
 * write a literal percent sign as "%%".
 * SPDX-License-Identifier: MIT
 */

var callStatus = rpc.declare({ object: 'luci.pingwatch', method: 'status', expect: { '': {} } });
var callData = rpc.declare({ object: 'luci.pingwatch', method: 'data', params: [ 'since', 'until' ], expect: { '': {} } });
var callCheck = rpc.declare({ object: 'luci.pingwatch', method: 'check', expect: { '': {} } });
var callSetSecret = rpc.declare({ object: 'luci.pingwatch', method: 'set_secret', params: [ 'secret' ], expect: { '': {} } });
var callClear = rpc.declare({ object: 'luci.pingwatch', method: 'clear', expect: { '': {} } });

/* CSV text with a header line -> array of objects. The backend keeps
 * commas, quotes and markup out of every field (clean()). */
function parseCSV(header, text) {
	var cols = String(header || '').split(','), rows = [];
	String(text || '').split('\n').forEach(function(line) {
		if (!line) return;
		var f = line.split(','), r = {};
		cols.forEach(function(c, i) { r[c] = f[i] != null ? f[i] : ''; });
		rows.push(r);
	});
	return rows;
}

function when(ts) {
	var d = new Date(+ts * 1000);
	return isNaN(d) ? '' : d.toLocaleString();
}

return baseclass.extend({
	callStatus: callStatus,
	callData: callData,
	callCheck: callCheck,
	callSetSecret: callSetSecret,
	callClear: callClear,
	parseCSV: parseCSV,
	when: when
});
