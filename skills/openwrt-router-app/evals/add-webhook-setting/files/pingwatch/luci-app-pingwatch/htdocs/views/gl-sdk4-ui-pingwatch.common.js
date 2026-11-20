/*
 * Ping Watch
 * Page for the GL.iNet admin panel (menu entry /usr/share/oui/menu.d/pingwatch.json).
 * The panel evaluates this file and uses the result as a Vue 2 component,
 * the same way as its own plugin pages. It only provides a frame; the app
 * runs inside it (/luci-static/resources/pingwatch/gl.js), so its styles and
 * scripts cannot change how the panel looks or works. The frame's content
 * comes from this page itself (srcdoc), so it shares the panel's origin
 * and can call the panel's window.$request through window.parent.
 * SPDX-License-Identifier: MIT
 */
module.exports = (function() {
	'use strict';
	var stamp = Date.now();
	var page = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
		'<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ping Watch</title></head>' +
		'<body><script src="/luci-static/resources/pingwatch/gl.js?_t=' + stamp + '"></script></body></html>';
	return {
		name: 'pingwatch',
		render: function(h) {
			return h('div', { staticClass: 'pingwatch-gl', style: { width: '100%', paddingBottom: '16px' } }, [
				h('iframe', {
					attrs: { title: 'Ping Watch', srcdoc: page },
					style: { display: 'block', width: '100%', height: '720px', border: '0', background: 'transparent' }
				})
			]);
		}
	};
})();
