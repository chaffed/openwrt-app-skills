/*
 * The pages in a real browser: OpenWrt 23.05 with LuCI in a container, the
 * package's files copied in, Chrome driven by playwright-core.
 *   - LuCI: log in, open Overview and Settings, save a setting and a
 *     secret, and check the secret never comes back to the browser.
 *   - GL.iNet panel: tests/gl/panel.html stands in for the panel (it loads
 *     the view file the way the panel does) and tests/gl/rpc.lua for its
 *     /rpc (the panel's argument check and its limited ngx.pipe), running
 *     the real Lua module.
 *
 * Needs docker, Google Chrome and: npm install --no-save playwright-core
 * APP_CHROME=/path/to/chrome picks another Chromium; APP_KEEP=1 leaves the
 * container running (http://127.0.0.1:18580, root / luci-test).
 * Run: node tests/web.test.js
 */
var fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http');

var ROOT = path.join(__dirname, '..');
var NAME = 'pingwatch-test-web', IMAGE = 'pingwatch-test-web', PORT = 18580;
var WEB = 'http://127.0.0.1:' + PORT, ROOT_PW = 'luci-test';
/* Characters that break naive quoting in shell, JSON, UCI and HTML. */
var SECRET = 'Se cr,e"t\'$x\\`1<b>';

var playwright;
try { playwright = require('playwright-core'); }
catch (e) { console.error('playwright-core is not installed. Run: npm install --no-save playwright-core'); process.exit(2); }

var fail = 0;
function ok(cond, name) { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + name); return cond; }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function docker(args, input) { return cp.execFileSync('docker', args, { input: input, encoding: 'utf8', stdio: [ 'pipe', 'pipe', 'pipe' ] }); }
function router(script) { return docker([ 'exec', '-i', NAME, 'sh', '-s' ], script); }
function get(url) {
	return new Promise(function(resolve, reject) { http.get(url, function(res) { res.resume(); resolve(res.statusCode); }).on('error', reject); });
}

(async function() {
	var browser, replies = [], problems = [];
	try {
		docker([ 'build', '-q', '--platform', 'linux/amd64', '-t', IMAGE, path.join(ROOT, 'tests', 'openwrt') ]);
		try { docker([ 'rm', '-f', NAME ]); } catch (e) { /* not running */ }
		docker([ 'run', '-d', '--platform', 'linux/amd64', '--name', NAME, '-p', '127.0.0.1:' + PORT + ':80',
			'-v', path.join(ROOT, 'luci-app-pingwatch') + ':/pkg:ro', '-v', path.join(ROOT, 'tests') + ':/tests:ro', IMAGE, '/sbin/init' ]);
		for (var i = 0; i < 100; i++) {
			try { if (await get(WEB + '/cgi-bin/luci/')) break; } catch (e) { /* not up yet */ }
			await sleep(300);
		}
		router([
			'set -e',
			'cp -R /pkg/root/. /',
			'cp -R /pkg/htdocs/. /www/',
			'chmod 755 /usr/bin/pingwatch /usr/libexec/rpcd/luci.pingwatch /etc/init.d/pingwatch',
			'chmod 600 /etc/config/pingwatch_auth',
			'uci set pingwatch.main.enabled=0 && uci commit pingwatch',
			'sh /etc/uci-defaults/80_pingwatch',
			/* The GL panel stand-in, served by uhttpd. */
			'mkdir -p /www/gl && cp /tests/gl/panel.html /www/gl/panel.html',
			'cp /tests/gl/rpc.lua /www/cgi-bin/gl-rpc && chmod 755 /www/cgi-bin/gl-rpc',
			'printf "%s\\n%s\\n" ' + ROOT_PW + ' ' + ROOT_PW + ' | passwd root >/dev/null 2>&1',
			'/usr/bin/pingwatch check >/dev/null 2>&1 || true'
		].join('\n'));

		browser = await playwright.chromium.launch(process.env.APP_CHROME ? { executablePath: process.env.APP_CHROME } : { channel: 'chrome' });
		var page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
		page.on('response', function(res) {
			if (/\/(cgi-bin|ubus)/.test(res.url())) replies.push(res.text().catch(function() { return ''; }));
		});

		/* ------------------------------------------------------------ LuCI */
		await page.goto(WEB + '/cgi-bin/luci/');
		await page.fill('input[name=luci_username]', 'root');
		await page.fill('input[name=luci_password]', ROOT_PW);
		await Promise.all([ page.waitForNavigation(), page.press('input[name=luci_password]', 'Enter') ]);
		/* Script errors count from here on (the login page answers 403). */
		page.on('pageerror', function(e) { problems.push('page error: ' + e.message); });
		page.on('console', function(m) { if (m.type() === 'error') problems.push('console: ' + m.text()); });

		await page.goto(WEB + '/cgi-bin/luci/admin/services/pingwatch/overview');
		await page.waitForSelector('text=Latest readings', { timeout: 15000 });
		ok(await page.isVisible('text=Check now'), 'LuCI Overview shows its readings and the Check now button');
		ok(await page.isVisible('text=The target did not answer') || await page.isVisible('td >> text=OK'), 'LuCI Overview lists the stored reading');

		await page.goto(WEB + '/cgi-bin/luci/admin/services/pingwatch/settings');
		await page.waitForSelector('input[type=password]', { timeout: 15000 });
		await page.selectOption('select[id$="interval"]', '15');
		await page.fill('input[type=password]', SECRET);
		/* "Save" only stages the change in the session; "Save & Apply"
		 * commits it (and runs the reload triggers). */
		await page.click('.cbi-page-actions .cbi-button-apply');
		await page.waitForSelector('text=Secret saved', { timeout: 15000 });
		for (i = 0; i < 200 && router('uci -q get pingwatch.main.interval').trim() !== '15'; i++) await sleep(300);
		ok(router('uci -q get pingwatch.main.interval').trim() === '15', 'LuCI Settings saves a setting');
		ok(router('uci -q get pingwatch_auth.main.secret').replace(/\n$/, '') === SECRET, 'LuCI Settings saves the secret exactly, quoting characters and all');
		await page.reload();
		await page.waitForSelector('input[type=password]', { timeout: 15000 });
		ok((await page.inputValue('input[type=password]')) === '', 'LuCI Settings never fills the saved secret back in');

		/* ---------------------------------------------- GL panel stand-in */
		await page.goto(WEB + '/gl/panel.html');
		var frame = null;
		for (i = 0; i < 50 && !frame; i++) {
			frame = page.frames().find(function(f) { return f !== page.mainFrame(); });
			await sleep(200);
		}
		ok(!!frame, 'GL panel: the view file shows the app in a frame');
		await frame.waitForSelector('text=Latest readings', { timeout: 15000 });
		ok(true, 'GL panel: the LuCI Overview view runs inside the panel');
		ok(await page.textContent('#menu-label') === 'Ping Watch', 'GL panel: the menu label comes from the i18n file');
		await frame.click('button[data-page=settings]');
		await frame.waitForSelector('input[type=password]', { timeout: 15000 });
		await frame.fill('input[type=text]', '9.9.9.9');
		await frame.fill('input[type=password]', SECRET + '2');
		await frame.click('button[type=submit]');
		await frame.waitForSelector('text=Settings saved', { timeout: 15000 });
		ok(router('uci -q get pingwatch.main.target').trim() === '9.9.9.9', 'GL panel: Settings saves a setting through the Lua module');
		ok(router('uci -q get pingwatch_auth.main.secret').replace(/\n$/, '') === SECRET + '2', 'GL panel: Settings saves the secret, quoting characters and all');
		ok(router('cat /tmp/gl-rpc-spawn.log 2>/dev/null').indexOf('cr,e') < 0, 'GL panel: the secret was never a command argument');

		var all = (await Promise.all(replies)).join('\n');
		ok(all.indexOf('cr,e') < 0 && all.indexOf('Se cr') < 0, 'the secret never came back to the browser in any reply');
		ok(problems.length === 0, 'no script errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
	} catch (e) {
		ok(false, 'the test ran to the end: ' + (e.stack || e));
	} finally {
		if (browser) await browser.close();
		if (process.env.APP_KEEP) console.log('container left running: ' + WEB + ' (root / ' + ROOT_PW + '); remove with: docker rm -f ' + NAME);
		else { try { docker([ 'rm', '-f', NAME ]); } catch (e) { /* gone */ } }
	}
	console.log(fail ? '\n' + fail + ' check(s) failed' : '\nall checks passed');
	process.exit(fail ? 1 : 0);
})();
