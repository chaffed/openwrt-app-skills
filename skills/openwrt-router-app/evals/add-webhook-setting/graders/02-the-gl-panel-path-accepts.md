---
type: llm
focus: trace
weight: 1
---

The GL panel path accepts the example URL https://ntfy.sh/my-topic?title=Ping%20down&priority=high: set_config stays exempt from the panel's default argument check, and the module's own check allows ? & = % while rejecting spaces and quotes
