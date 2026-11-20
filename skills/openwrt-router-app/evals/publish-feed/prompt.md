---
tags: [openwrt-router-app]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I've got two LuCI apps on GitHub (chaffed/luci-app-ispy and chaffed/luci-app-modemhealth), each with the .ipk attached to its releases. I want a package source hosted on GitHub that people can add to their OpenWrt routers, so they can install and update both with opkg. Write whatever scripts and GitHub workflow are needed into feed/, plus a short README telling router owners how to add it. Don't create any repos or push anything, just write the files.
