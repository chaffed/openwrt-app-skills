'use strict';
'require view';
'require form';
'require ui';
'require __APP__.common as app';

/*
 * __TITLE__ - Settings (UCI config /etc/config/__APP__).
 *
 * The secret is not part of this form's config: it is kept in
 * /etc/config/__APP___auth, which this page never loads, and is saved
 * through the set_secret call. The page only learns whether one is set.
 *
 * A new setting must also go in the GL panel's form (gl.js: sections) and
 * the panel module's FIELDS (/usr/lib/oui-httpd/rpc/__APP__);
 * tests/settings.test.js checks that all three agree.
 * SPDX-License-Identifier: MIT
 */

return view.extend({
	load: function() {
		return app.callStatus().catch(function() { return {}; });
	},

	render: function(st) {
		var m, s, o, self = this;

		m = new form.Map('__APP__', _('__TITLEJS__ – Settings'), _('__DESCJS__'));

		s = m.section(form.NamedSection, 'main', '__APP__');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('Check on a schedule'));
		o.rmempty = false;
		o.default = '1';

		o = s.option(form.ListValue, 'interval', _('Check every'));
		[ [ '1', _('1 minute') ], [ '5', _('5 minutes') ], [ '15', _('15 minutes') ], [ '60', _('60 minutes') ] ]
			.forEach(function(v) { o.value(v[0], v[1]); });
		o.default = '5';

		o = s.option(form.Value, 'target', _('Host to check'));
		o.datatype = 'host';
		o.default = '1.1.1.1';
		o.placeholder = '1.1.1.1';
		o.rmempty = false;

		o = s.option(form.Value, 'history_days', _('Keep history for (days)'));
		o.datatype = 'and(uinteger,range(1,730))';
		o.placeholder = '90';
		o.rmempty = true;

		/* Write-only: never filled in from the router. Names starting with
		 * "_" are not stored by the form. */
		o = s.option(form.Value, '_secret', _('Secret'),
			st.secret_set ? _('A secret is saved. Leave empty to keep it. Saved secrets are never shown.') : _('Optional.'));
		o.password = true;
		o.placeholder = st.secret_set ? _('(saved)') : '';
		o.cfgvalue = function() { return ''; };
		o.write = function(section_id, value) { self.newSecret = value; };
		o.remove = function() {};

		return m.render();
	},

	/* Save the secret (if one was typed) through its own call, then the
	 * other settings as usual. */
	handleSave: function(ev) {
		var self = this;
		self.newSecret = null;
		return this.super('handleSave', [ ev ]).then(function() {
			if (!self.newSecret) return;
			return app.callSetSecret(self.newSecret).then(function(r) {
				if (!r || !r.ok) throw new Error(_('the router did not save it'));
				self.newSecret = null;
				ui.addNotification(null, E('p', {}, [ _('Secret saved.') ]), 'info');
			}).catch(function(e) {
				ui.addNotification(null, E('p', {}, [ _('The secret was not saved: %s').format(String(e.message || e)) ]), 'warning');
			});
		});
	}
});
