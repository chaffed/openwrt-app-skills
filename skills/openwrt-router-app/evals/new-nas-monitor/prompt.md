---
tags: [openwrt-router-app]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I've got a GL.iNet Flint 2 (GL-MT6000, firmware 4.x) and a Synology NAS at 192.168.8.20. Can you build me a router app that checks every few minutes whether the NAS answers on its web port (5001, https) and keeps a history I can look at in the GL admin panel? I never use LuCI but others might, so it should work there too. Package it so I can opkg install it. Put the project in nas-watch/.
