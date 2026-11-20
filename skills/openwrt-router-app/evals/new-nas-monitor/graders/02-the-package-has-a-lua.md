---
type: llm
focus: trace
weight: 1
---

The package has a Lua RPC module at /usr/lib/oui-httpd/rpc/<id> that runs commands with ngx.pipe.spawn given an argument table and calls only stdout_read_all(), read_all() or wait() on the result (no set_timeouts, write, shutdown or other OpenResty-only methods)
