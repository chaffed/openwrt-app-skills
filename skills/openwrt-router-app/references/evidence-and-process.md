# Evidence standards, privacy, and working on the user's router

## Contents
1. When results are evidence
2. Privacy in public artifacts
3. The user's router is production
4. Secrets and permissions
5. A work loop that worked
6. Before saying where things stand

## 1. When results are evidence

Router monitoring apps are often built to prove something to an ISP or a regulator: slow speeds, a failing line, outages. A report like that is only useful if the provider can't wave it away. These rules came out of two such apps:

- **Failed stays failed.** A reading that couldn't be taken is stored as `failed` with its reason, never as empty, zero or good. Reasons include: server refused, rate-limited, device unreachable, login refused, router clock not set. A rate-limited speed test once got stored as "0.03 Mbit/s, ok" and was drawn as 0 on the chart. Count failed checks as *unknown*, never as faults.
- **Settle measurement ambiguity in the provider's favour.** Example: report the higher of two speed measurements. Then any shortfall you report survives scrutiny.
- **Don't record anything until the router's clock is set by NTP.**
- **Every threshold has a source.** Cite the specification, such as DOCSIS 3.0/3.1 PHY, or the manufacturer's guidance. Mark a limit as `judgement` when no source exists. Keep the limits and their sources in one module (`health.js` in Modem Health), which the pages and the report both read. Copied tables of unclear origin don't count as sources: the widely shared "Xfinity signal table" is a volunteer's forum post. When no published threshold exists (error counts without a total, for example), report the value without judging it.
- If the user changes a limit, the report says which limits were changed and that the default's sources no longer back them.
- **Word claims carefully:**
  - give outages as "at least" what the checks prove, plus the gap between the good checks around them
  - mark reports with less than 72 hours of data as preliminary
  - say that events happening together don't prove what caused them
  - give per-day rates only for periods of 24 hours or more
- **The report is a single self-contained HTML file** that opens in any browser and prints well. Save it to the USB drive once a day. Include the subscriber and account details the user enters for the report. Make CSV exports safe against spreadsheet formula injection: prefix any field starting with `= + - @` with `'`.
- **Test the statistics against an independent calculation** in a unit test.

## 2. Privacy in public artifacts

- README screenshots, demo data and the sample report come from *generated* data, with documentation addresses and an invented subscriber name. Never use the user's own readings, IP, MAC, serial, ISP account or address.
- Fixtures are redacted (see `device-protocols.md` §3).
- Delete copies of real data from scratch folders when done. If a safety check blocked the deletion, tell the user.
- Don't put the user's name, email, router address or ISP into public repos, issues, commit messages or external requests unless they ask.

## 3. The user's router is production

It carries the household's internet. So:
- **Check whether you can reach it** before saying something is untested on hardware: `ssh -o BatchMode=yes -o ConnectTimeout=8 root@<router> 'cat /tmp/sysinfo/model'`. Identify it with `cat /etc/glversion` and `. /etc/openwrt_release`.
- **Ask first** before:
  - rebooting it
  - a clean reinstall (removing the package and its settings)
  - installing LuCI or third-party packages
  - running vendor scripts
  - anything that interrupts the connection or uses a lot of data (one speed test on a gigabit line moved 3 GB)

  For a reboot test, after approval: take checksums of the data files first and compare them afterwards. Check that the service restarted by itself, and that the reboot wasn't recorded as an outage or a device restart.
- Read vendor scripts before running them. Back up what they change (`uci export <cfg>`, `opkg list-installed`).
- **Closed-source binaries and EULAs are the user's call.** Don't install them or accept terms on the user's behalf unless they ask.
- Clean up after yourself:
  - leftover `-opkg` files
  - temp folders
  - throwaway rpcd plugins (then reload rpcd)
  - ssh commands that hit a tool timeout and keep running on the router (find them with `pgrep -f` and kill them)
- At the end, list every change you made to the router.
- When something matters on the hardware, say whether it was verified on the router or only in a container. Things only real hardware showed:
  - GL's `ngx.pipe`
  - rpcd not running on GL firmware
  - LuCI on port 8080
  - the USB mount path
  - the time zone spelling
  - that WAN counters include hardware-accelerated traffic
  - device session rules

## 4. Secrets and permissions

- Device passwords: the user types them, at a hidden prompt, through `ssh -t … read -rs`, or in the Settings page. They live only in the 600 `_auth` file. They never appear in argv, logs, stored files, command output, browser replies or chat.
- Signing keys never go into a repo. Keep a backup outside the hosting service.
- Treat permission refusals as part of the environment. Things that were refused while building these apps:
  - making a LuCI session by hand with admin ACLs on the real router
  - deleting the current directory
  - a single combined "create repo + upload secret + publish" command
  - a disruptive clean reinstall on the router

  Don't work around a refusal. Explain what was blocked, offer options, and run approved steps one at a time.
- Creating public repos, uploading secrets and publishing releases or feeds are outward-facing. Confirm them with the user.

## 5. A work loop that worked

- Start by reading a sibling app's structure, build, CI, tests and CLAUDE.md, and reuse its seams.
- For a big app:
  - write the spec as an issue with user stories
  - split it into vertical slices as sub-issues with real "blocked by" links; each slice is something the user can try on the router
  - get the test seams approved before coding
- Per slice:
  1. branch
  2. tests first or alongside
  3. install on the router
  4. evidence in the PR: real-hardware results, and what was *not* verified
  5. CI green
  6. squash-merge with a subject naming the issue and the PR (`"Title (#11) (#25)"`)
  7. next slice

  Once the user approves this loop, keep going without asking each time. Stop for anything disruptive to the router or network, for publishing, or for a change of plan.
- **Verify by building a rig, don't hand the check back.** When a check seems to need the user's browser or login, build the container plus stand-in panel plus Playwright. Leave only the final look on the real device to the user, and say so in the PR (use "Part of #n" until they confirm).
- **Record each hard-won fact in CLAUDE.md in the same PR.** Many lessons here had to be rediscovered because they stayed in a transcript.

## 6. Before saying where things stand

Check GitHub first (`gh issue list --state all`, `gh pr list --state all`, `gh release list`) and the router (`opkg list-installed | grep luci-app-`). Don't answer from memory: once an agent said an app wasn't finished when every ticket was merged and the release was out.
