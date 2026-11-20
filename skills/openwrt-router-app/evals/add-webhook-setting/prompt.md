---
tags: [openwrt-router-app]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

This is my router app (pingwatch/, OpenWrt + GL.iNet admin panel). Add an optional setting for a webhook URL, for example https://ntfy.sh/my-topic?title=Ping%20down&priority=high - when a check fails the router should POST a short message to it. It has to be settable from both LuCI and the GL.iNet admin panel. Keep the existing tests passing.

Input files: pingwatch/
