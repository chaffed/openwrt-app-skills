# LuCI: menu, permissions, rpcd and the JS views

Target: OpenWrt 23.05's client-side LuCI (JS views, ucode dispatcher). On GL firmware LuCI is optional. Once installed it runs on port 8080 and 8443, and it is a mixed build (luci-base git-26.x with luci-light git-24.x). Views written for 22.03/23.05 worked on it unchanged.

## Contents
1. Menu entry
2. ACL
3. rpcd plugin
4. Views and shared code
5. Settings forms and the write-only secret
6. Traps
7. Seeing changes after install

## 1. Menu entry

`/usr/share/luci/menu.d/luci-app-<id>.json`:
- An `admin/services/<id>` node with `"action": {"type": "alias", "path": "admin/services/<id>/overview"}` and `"depends": {"acl": ["luci-app-<id>"], "uci": {"<id>": true}}`.
- One child per page with `{"type": "view", "path": "<id>/overview"}`, which maps to `htdocs/luci-static/resources/view/<id>/overview.js`.
- `depends.uci` needs `/etc/config/<id>` to exist. `depends.acl` must name the ACL group.
- LuCI builds menus in the browser, so grepping the page HTML won't find an entry. Ask `GET /cgi-bin/luci/admin/menu` with the session cookie instead.

## 2. ACL

`/usr/share/rpcd/acl.d/luci-app-<id>.json`, with one group named `luci-app-<id>`:
- `read`: `ubus` read-only methods (status, data) and `uci: ["<id>"]`.
- `write`: anything that changes state or contacts a device (check, test, set_secret, export, clear), plus `uci: ["<id>"]`.
- Anything listed in `uci` is readable by the page. That is why secrets live in a separate `<id>_auth` config that no ACL lists.

## 3. rpcd plugin

An exec plugin at `/usr/libexec/rpcd/luci.<id>` (mode 755):
- `list` prints the method signatures as JSON, for example `{"data":{"since":0,"until":0},"set_secret":{"secret":"str"}}`. `ubus -v list luci.<id>` shows the types.
- `call <method>` reads its JSON input on stdin: `. /usr/share/libubox/jshn.sh; read -r input; json_load "$input"; json_get_var since since`. shellcheck can't see that `json_get_var` sets variables, so add `disable=SC1091,SC2154`.
- Hand secrets on through stdin or the environment, never as arguments.
- After installing or changing it: `/etc/init.d/rpcd reload`. Test it directly with `ubus call luci.<id> status`.
- **On stock GL firmware, rpcd is not running until LuCI is installed.** The GL panel uses its own Lua RPC instead (see `glinet-panel.md`).

## 4. Views and shared code

- **A view** is `'use strict'; 'require view'; 'require poll'; 'require ui'; 'require <id>.common as app';` followed by `return view.extend({ load(), render(data), handleSave/handleSaveApply/handleReset })`. Set the handlers to `null` on pages without a form, to hide LuCI's Save buttons.
- **Shared code** lives in `htdocs/luci-static/resources/<id>/common.js` as `return baseclass.extend({...})`, and holds the `rpc.declare` calls, parsing, formatting and limits. One module can serve the LuCI pages, the GL panel (through `gl.js`) and a standalone report file.
- `rpc.declare({ object: 'luci.<id>', method: 'data', params: ['since','until'], expect: { '': {} } })` returns the whole reply object.
- Use `poll.add(fn, seconds)` for refreshes. Pages that poll never reach Playwright's `networkidle`.
- Draw charts as SVG *strings* run through an `esc()` helper. The pages, the report and node tests can then share one implementation. Size bars from the check interval, not from the number of points: with a few points on a long axis, bars otherwise merge into one block.
- Node unit tests can load a LuCI module with `new Function('baseclass', src)({ extend: o => o })`, given stand-ins for `String.prototype.format` and `_()`.
- Syntax-check every view in CI with `node -e "new Function(require('fs').readFileSync(f,'utf8'))"`. Views aren't ES modules, so `node --check` doesn't apply. This catches the missing paren that LuCI would only report when the page loads.

## 5. Settings forms and the write-only secret

```js
m = new form.Map('<id>', _('Title'), _('Description'));
s = m.section(form.NamedSection, 'main', '<id>'); s.anonymous = true;
o = s.option(form.Value, 'target', _('Host')); o.datatype = 'host'; o.rmempty = false;

/* Write-only secret: a name starting with "_" is not stored by the form. */
o = s.option(form.Value, '_secret', _('Secret'), st.secret_set ? _('A secret is saved. Leave empty to keep it.') : '');
o.password = true;
o.placeholder = st.secret_set ? _('(saved)') : '';
o.cfgvalue = function() { return ''; };
o.write = function(sid, v) { self.newSecret = v; };
o.remove = function() {};
```
Then override `handleSave` to call `this.super('handleSave', [ev])` first, followed by the `set_secret` rpc when `newSecret` is set. `handleSaveApply` calls `handleSave`, so it is covered too. Get `secret_set` from the status call in `load()`.

- Tabs: `s.tab('name', _('Label'))` and `s.taboption('name', form.X, …)`.
- Validation: set `o.datatype` ('host', 'uinteger', `'and(uinteger,range(1,730))'`, `'or(host,hostport)'`). For cross-field rules, use `o.validate = function(sid, value) { return true or 'message'; }`, read siblings with `this.section.children` and `formvalue(sid)`, and re-run validation on the others with `getUIElement(sid).triggerValidation()`.
- A "Test connection" button is a `form.Button` with `onclick`. Read the typed values with `m.lookupOption(name, sid)[0].formvalue(sid)`, call a `test` rpc, and give a distinct message for each failure reason.
- **"Save" only stages changes** in the session (`/tmp/run/rpcd/uci-<session>/`). **"Save & Apply" commits them** and runs the reload triggers, after a rollback/confirm cycle that takes several seconds. **The page must stay open until LuCI shows "Configuration changes applied"**: if the browser leaves or reloads earlier, the confirm never reaches rpcd and it rolls every change back about 90 s later, silently. Tests must click `.cbi-button-apply` and wait for that text (up to about 2 minutes) before reloading or reading UCI; a test that reads UCI straight away passes and then the change disappears.

## 6. Traps

- **`E(tag, attrs, 'string')` sets the string as innerHTML.** Text from the router, a device or stored files must be an array child: `E('td', {}, [ text ])`. Also strip markup in the backend before storing. Test with `<img src=x onerror=…>` in the data.
- **`String.prototype.format`** reads `%` followed by a space or one of `b c o q t m u x X j` as a conversion. `'below 80% of'.format(n)` prints `below 8037f`. Write `%%` in every string passed to `.format()`. A test can scan all `.format(` strings for a bare `%`. The bug only showed up when the rendered text was compared with the expected text, so assert on wording, not just on "no errors".
- Helpers that turn values into text nodes must accept numbers, not only strings.
- Time zones: `system.@system[0].zonename` is spelled with a space (`America/Los Angeles`). Compare it with the browser's `Intl` zone by replacing spaces with `_`, or better, by comparing UTC offsets in January and July.

## 7. Seeing changes after install

- Clear the menu and module caches, then reload rpcd: `rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache; /etc/init.d/rpcd reload`. uci-defaults and postrm do this.
- A browser that is already logged in keeps the old menu until the user logs out and back in, or until the session ends.
- View JS is cached by the browser. Use a hard reload when checking by hand.
- **Testing on the real router:** call `ubus call luci.<id> …` directly. Do *not* make LuCI sessions by hand there with `ubus call session create` and access-group grants. It works (a `*` access-group grant gives HTTP 403; each group named in acl.d has to be granted), but it amounts to logging in without the password, and permission systems rightly refuse it. Use the container rig for browser tests (see `testing.md`).
