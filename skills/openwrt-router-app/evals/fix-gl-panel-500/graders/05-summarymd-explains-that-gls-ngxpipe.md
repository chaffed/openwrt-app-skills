---
type: llm
focus: trace
weight: 1
---

SUMMARY.md explains that GL's ngx.pipe is not OpenResty's (only spawn, stdout_read_all and wait exist; no stdin) and that nginx keeps a loaded Lua module in memory until reloaded
