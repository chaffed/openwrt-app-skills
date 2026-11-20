---
type: llm
focus: trace
weight: 1
---

The backend POSTs to the webhook only when a check fails, passing the URL to curl as one quoted argument (no eval, no sh -c, no unquoted expansion) with a time limit
