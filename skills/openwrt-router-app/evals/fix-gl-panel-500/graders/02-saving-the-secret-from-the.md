---
type: llm
focus: trace
weight: 1
---

Saving the secret from the GL panel no longer depends on the process's stdin or a command-line argument: the module writes it with UCI (or into a root-only file) and the auth file stays mode 600
