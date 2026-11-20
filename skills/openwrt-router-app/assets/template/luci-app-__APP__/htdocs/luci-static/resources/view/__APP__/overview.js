'use strict';
'require view';
'require poll';
'require ui';
'require __APP__.common as app';

/*
 * __TITLE__ - Overview. Also runs inside the GL.iNet admin panel (gl.js
 * provides stand-ins for view, poll, ui, E, _ and the rpc calls), so use
 * only those LuCI APIs here, or add a stand-in for any new one.
 *
 * E(tag, attrs, 'text') assigns a bare string with innerHTML: text that
 * comes from stored readings is always passed as an array child, [ text ].
 * SPDX-License-Identifier: MIT
 */

var DAY = 86400;

function reasonText(r) {
	var known = { no_answer: _('The target did not answer.'), unknown: _('The check failed.') };
	return known[r] || _('The check failed (%s).').format(r);
}

return view.extend({
	load: function() {
		var now = Math.floor(Date.now() / 1000);
		return Promise.all([ app.callStatus(), app.callData(now - DAY, now) ]);
	},

	renderRows: function(data) {
		var rows = app.parseCSV(data.header, data.csv).slice(-20).reverse();
		if (!rows.length)
			return E('p', { 'class': 'app-empty' }, [ _('No readings yet.') ]);
		return E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ _('Time') ]),
				E('th', { 'class': 'th' }, [ _('Result') ]),
				E('th', { 'class': 'th' }, [ _('Loss') ]),
				E('th', { 'class': 'th' }, [ _('Average') ])
			])
		].concat(rows.map(function(r) {
			var ok = r.result === 'ok';
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ app.when(r.ts) ]),
				E('td', { 'class': 'td' }, [ ok ? _('OK') : reasonText(r.reason) ]),
				E('td', { 'class': 'td' }, [ ok ? '%s%%'.format(r.loss_pct) : '' ]),
				E('td', { 'class': 'td' }, [ ok ? _('%s ms').format(r.avg_ms) : '' ])
			]);
		})));
	},

	renderStatus: function(st) {
		return E('div', { 'class': 'cbi-section' }, [
			E('p', {}, [ st.enabled ? _('Checking %s every %d minutes.').format(st.target, st.interval) : _('Scheduled checks are off.') ]),
			st.next ? E('p', {}, [ _('Next check: %s').format(app.when(st.next)) ]) : ''
		]);
	},

	render: function(got) {
		var self = this, st = got[0] || {}, data = got[1] || {};
		var statusBox = E('div', {}, [ this.renderStatus(st) ]);
		var rowsBox = E('div', {}, [ this.renderRows(data) ]);

		var refresh = function() {
			var now = Math.floor(Date.now() / 1000);
			return Promise.all([ app.callStatus(), app.callData(now - DAY, now) ]).then(function(r) {
				statusBox.replaceChildren(self.renderStatus(r[0] || {}));
				rowsBox.replaceChildren(self.renderRows(r[1] || {}));
			});
		};
		poll.add(refresh, 30);

		var checkBtn = E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, function() {
			return app.callCheck().then(refresh).catch(function(e) {
				ui.addNotification(null, E('p', {}, [ _('The check could not run: %s').format(String(e.message || e)) ]), 'warning');
			});
		}) }, [ _('Check now') ]);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('__TITLE__') ]),
			statusBox,
			E('div', { 'class': 'cbi-section' }, [ checkBtn ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, [ _('Latest readings') ]), rowsBox ])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
