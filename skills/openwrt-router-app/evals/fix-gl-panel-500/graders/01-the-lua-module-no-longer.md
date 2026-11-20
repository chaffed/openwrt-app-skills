---
type: llm
focus: trace
weight: 1
---

The Lua module no longer calls set_timeouts, write or shutdown on the ngx.pipe process; time limits are passed in spawn's options table
