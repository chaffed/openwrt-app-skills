# The GL.iNet admin panel (firmware 4.x)

The panel is undocumented. Everything here was learned by reading firmware 4.10.1 on a GL-BE9300 (OpenWrt 23.05): `/www/js/app.<hash>.js.gz`, `/usr/share/gl-ngx/*.lua`, `/usr/lib/lua/oui/rpc.lua` and the plain-Lua stock modules. A future firmware may change any of it. LuCI pages keep working if it does, so say so to the user. The full working implementation is in `github.com/chaffed/luci-app-modemhealth` (`gl.js`, `rpc/modemhealth`, `tests/gl/`).

## Contents
1. The pieces and where they go
2. How the panel loads a page
3. The Lua RPC module
4. The argument validator
5. `$request` and errors
6. GL's `ngx.pipe`
7. The iframe and gl.js pattern
8. Theme
9. Testing

## 1. The pieces and where they go

| What | Path on the router | Source in the package |
|---|---|---|
| Menu entry | `/usr/share/oui/menu.d/<view>.json` | `root/usr/share/oui/menu.d/` |
| Menu label | `/www/i18n/gl-sdk4-ui-<view>.<lang>.json`, key `menu_<view>` | `htdocs/i18n/` |
| Page | `/www/views/gl-sdk4-ui-<view>.common.js` | `htdocs/views/` |
| RPC module | `/usr/lib/oui-httpd/rpc/<object>` (Lua file returning a table) | `root/usr/lib/oui-httpd/rpc/` |
| Validator exemptions | `/usr/share/gl-validator.d/<object>.lua` | `root/usr/share/gl-validator.d/` |
| App code in the frame | `/www/luci-static/resources/<id>/gl.js` (served without login, like all of `/www`) | `htdocs/luci-static/resources/<id>/` |

Menu entry: `{"index":110,"view":"<id>","level":2,"parent":"applications","parent_icon":"application","parent_index":55}`.
- `index` is the order within Applications. Stock indexes: plugins 10, dynamicdns 12, nasview 40, adguardhome 80, bark 100, tailscale 101, zerotier 102, tor 106.
- Optional keys seen on stock entries: `show_mode: ["router"]`, `country`, `firmware_categories`, `disables`.

i18n: stock languages are en, de, es, it, ja, zh-cn and zh-tw. Ship all seven, even if the label is the same in each, so no language shows a raw key. The panel loads them through RPC `ui.load_locales`.

## 2. How the panel loads a page

The panel gets its menu with RPC `["sid","ui","get_menu_list",{}]`. For each view it runs `axios.get('/views/gl-sdk4-ui-<view>.common.js?_t=…')`, then `eval`s the text and uses the result as a **Vue 2 component** for the route. A plain `.js` file is served (nginx `gzip_static on` also serves `.js.gz`). `module.exports = { name, render(h) { … } }` is enough. There's no need to build with Vue.

## 3. The Lua RPC module

- nginx: `location = /rpc` → `oui-access.lua` (login check), then `oui-rpc.lua` → `/usr/lib/lua/oui/rpc.lua`.
- Request: `{"jsonrpc":"2.0","id":1,"method":"call","params":[sid,"<object>","<method>",{args}]}`.
- `rpc.lua` `dofile`s `/usr/lib/oui-httpd/rpc/<object>` and calls `M[method](args)`. It falls back to C modules (`<object>.so`) through `/cgi-bin/glc`.
- An admin session (`aclgroup == "root"`) may call any module.
- **nginx keeps a module in memory once it has been used** (`objects[object]` per worker). A new version only takes effect after `/usr/sbin/nginx -s reload`. That is graceful: the master pid stays the same and open pages aren't cut off. Do it in uci-defaults and postrm, guarded by `[ -d /usr/lib/oui-httpd/rpc ] && [ -s /var/run/nginx.pid ]`.
- **The panel writes every call to the system log unless the method name contains `get`, `load` or `check`.** Name the polled methods `get_status`/`get_data`, and map the LuCI method names to them in `gl.js`.
- **Lua on GL is 5.1.5 with 32-bit integers.** `string.format("%d", 9999999999)` is wrong. Use `"%.0f"`.
- Plain-Lua stock modules to learn from (most others are bytecode): `/usr/lib/oui-httpd/rpc/{bark,diag,fan,sms-forward,tailscale,tor,wg_client}`. Copy their doc-comment style (`@object-name`, `@method-name`, `@method-desc`, `@in`, `@out`, `@in-example`).
- `uci.cursor()` (libuci-lua) and `cjson` are available. Note that the panel encodes an empty table as `[]`, not `{}`.
- Keep every setting the panel may write in a `FIELDS = { name = { check = fn, optional = bool } }` table. `set_config` accepts nothing unless every value passes, and returns `{err_code=-1, err_msg=…, field=name}` for the first value that fails.

## 4. The argument validator

- **Default rule:** `/usr/share/gl-validator.d/<object>.lua` is `dofile`d on every call. Without it, every *string* argument must match `^[%w%. %-_:#/]-$`: letters, digits, space and `.-_:#/` only. Commas, apostrophes, `@` and accents are refused. Argument names must match `^[%a_-]`, and only strings, numbers, booleans and tables pass.
- **Exemptions:** the file returns a table keyed by method name. `true` skips the check for that method; a table maps argument names to Lua patterns or functions.
- Exempt only the methods that check their own input (`set_config`, `set_secret`, `test`). Leave the default rule on the rest.
- Stock validators are Lua bytecode (`LuaQ` header), so you can't read them as text.
- A refused call comes back as JSON-RPC error `-32602` (Invalid params).

## 5. `$request` and errors

The panel's RPC client is `window.$request(method, params, options)` (an axios wrapper in app.js). Call it from the frame as `window.parent.$request('call', ['sid', '<object>', '<method>', {…}], { timeout: ms, isCancel: false, ignoreCoreErrTips: true })`. `ignoreCoreErrTips` stops the panel from showing its own error toast.

- A JSON-RPC `error` rejects with `type` `accessDenied` (-32000; this also clears the login cookie), `invalidParams` (-32602) or `loginOverLimit`.
- **A *result* that contains `err_code` or `err_msg` is rejected** as `{type:'api', message: err_msg, code: err_code, …rest}`. Use those fields only for errors: a successful reply must not carry them.
- The session cookie is `Admin-Token`. Sessions time out after `oui-httpd.main.session_timeout` seconds of idle (default 300).

## 6. GL's `ngx.pipe`

`ngx.pipe` is **GL's own**, defined in `/usr/share/gl-ngx/oui-init.lua`. It is not OpenResty's. `spawn(args, opts)` sends `{args, timeout = opts.stdout_read_timeout/1000}` over a unix socket to `/usr/sbin/gl-ngx-session`.

- The process object has only `wait()`, `read_all()` and `stdout_read_all()`. All three return stdout.
- There is no stdin, no environment and no `set_timeouts`. Calling an OpenResty method gives HTTP 500, and `/var/log/nginx/error.log` shows `attempt to call method 'set_timeouts' (a nil value)`.
- Use `ngx.pipe.spawn(argv_table, { stdout_read_timeout = ms, wait_timeout = ms })`, then `stdout_read_all()` and `wait()`. That works on GL and on OpenResty. Always pass an argv table: a string becomes `sh -c`.
- The default timeout is 10 s. After it, gl-ngx-session kills the direct child only; a detached grandchild survives.
- **Secrets can't be passed safely**: arguments are visible to every process, and there is no stdin. Write the secret with `uci.cursor()` directly into the 600 file. Create the file and `chmod 600` it first, because UCI keeps a file's mode. For a "test what was typed" call, use the root-only temp file handshake (see `backend.md` §5).

## 7. The iframe and gl.js pattern

The view file renders only an iframe whose content is `srcdoc`, so it shares the panel's origin. The page in the frame loads `/luci-static/resources/<id>/gl.js?_t=<now>`; the timestamp defeats caching. This has three benefits:
- the app's CSS and JS can't break the panel
- `window.parent.$request` is the panel's logged-in RPC client
- the LuCI views can be reused unchanged

`gl.js` contains:
- **Stand-ins** for the LuCI APIs the views use: `view`, `baseclass`, `rpc.declare` (which maps the object `luci.<id>` to `$request` and renames polled methods), `poll.add`, `ui.addNotification/showModal/hideModal/createHandlerFn`, `uci.load/get` if used, `dom`, `L.bind/L.url/L.resolveDefault`, `E`, `_`, and a reimplementation of `String.prototype.format`. List the views' needs first with `grep -o 'L\.[a-zA-Z]*\|ui\.[a-zA-Z]*\|uci\.[a-zA-Z]*\|dom\.[a-zA-Z]*\|poll\.[a-zA-Z]*' view/*.js | sort -u`. ISPy needed about a dozen.
- **A module loader.** It fetches `view/<id>/x.js`, parses the `'require a.b as c';` header lines, loads those modules first, and runs the body with `new Function(names…, src)`. Restrict it to the app's own modules.
- **A Settings form of its own**, because LuCI's `form` is too big to stand in for. It calls `get_config`, `set_config` and `set_secret`. Keep it in step with LuCI's form and `FIELDS` (tests/settings.test.js).
- **Height:** set `frameElement.style.height` from the content height after each render, using a MutationObserver or ResizeObserver plus a slow interval as a fallback. Include any open modal in the height.
- The frame keeps its last page across reloads in some flows. A test that reloads should click Overview first.

## 8. Theme

The panel's colours are CSS variables on its root element: `--primary`, `--primary-hover`, `--primary-background`, `--error`, `--warning`, `--success`, `--text-title`, `--text-subtitle`, `--text-regular`, `--text-weak`, `--text-hint`, `--background-card`, `--background-title`, `--background-content`, `--background-controller`, `--border`, `--divider`, `--shadow`, `--mask`, and others. The theme files are `/www/theme/{base.css,default/index.css.gz,dark/index.css.gz}`.

- Copy the variables from `parent.getComputedStyle(parent.document.documentElement)` into the frame's root, along with the body `font-family`.
- Give every variable a fallback value.
- Treat the theme as dark when the luminance of `--background-card` is below 0.4.
- Re-sync from a MutationObserver on `parent.document.head`, since the panel swaps stylesheets when the theme changes, and again 400 ms and 1500 ms later.
- Native buttons and inputs keep a white background in dark mode unless styled: give them `background: var(--background-controller)` or `var(--background-card)` and a matching text colour.

## 9. Testing

- **Without the real panel:**
  - `tests/gl/panel.html` stands in for the panel. It evaluates the view file the way the panel does, provides `window.$request` with the panel's error mapping, theme variables and `?theme=dark`, and has `<link rel="icon" href="data:,">`; without that, a favicon 404 counts as a script error.
  - `tests/gl/rpc.lua`, installed as `/www/cgi-bin/gl-rpc` in the LuCI container, runs the real module under Lua 5.1 + cjson + libuci-lua. It applies the default validator and the gl-validator.d file, and provides a `ngx.pipe` that fails on any method GL lacks. It also logs every command, so a test can prove a secret was never an argument.
  - Keep both stand-ins in step with the firmware files they were written from.
- **A Lua unit test** of the module (stubbing `ngx.pipe`, `uci` and `cjson`) can run in CI (`apt-get install lua5.1 lua-cjson`) and on the router's own `/usr/bin/lua`. macOS has no lua5.1, so use the container. Check a test against a deliberately broken copy of the module, to prove it can fail.
- **On the router without a browser:** requests from 127.0.0.1 with the header `glinet: 1` skip the login:
  ```sh
  curl -s http://127.0.0.1/rpc -H 'glinet: 1' -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"call","params":["","<object>","get_status",{}]}'
  ```
  From the LAN without a login, the same request gives `{"error":{"message":"Access denied","code":-32000}}`.
- The final look in the real panel, light and dark, needs the owner's admin login. Ask the user to check it, and say that it was checked against the stand-in and through nginx on the router.
- **Installing LuCI on GL**, if the user wants it: `sh /usr/bin/init_luci.sh web` is what the panel's "Install LuCI" button runs. It installs the bundled ipks from `/etc/luci_ipks`, puts uhttpd on ports 8080 and 8443, and enables rpcd. Read the script, and back up `uci export uhttpd` and `opkg list-installed`, before running it.
