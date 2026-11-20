# Talking to another device from the router

For apps that read a modem, NAS, UPS, camera, inverter or similar through its web interface. Modem Health's SURFboard reader is the worked example: `luci-app-modemhealth`, `tools/capture.py`, `tests/fake_modem.py`, `tests/fixtures/`.

## Contents
1. Find out how the device's own page logs in
2. Prototype from the laptop, capture real replies
3. Redact before anything becomes a fixture
4. Measure the device's rules on real hardware
5. Design from those rules
6. Your testing can damage the evidence
7. Build the fake device

## 1. Find out how the device's own page logs in

- **Read the device's JavaScript before writing any client.** Fetch the login page and the scripts it loads, then copy the algorithm exactly:
  - the hash (it was HMAC-SHA256, not the MD5 that guides online describe)
  - the argument order (`hmac(key, message)`)
  - upper or lower case hex
  - which key signs which step (the second login step was signed with the *new* key)
  - the cookie names and request headers
  - how replies are wrapped (one action vs several)
- Some devices serve their static JS only with a `Referer` header, and redirect (302) to the login page without one.
- The device usually has a self-signed certificate, so use `curl -k`.
- Check the router can do the crypto: `openssl dgst -sha256 -hmac KEY` (needs openssl-util) against a known HMAC test vector. Check the router can reach the device, often through the WAN port (e.g. `192.168.100.1` for cable modems), and time it.

## 2. Prototype from the laptop, capture real replies

- Write a small capture tool (Python, standard library only) that logs in, makes each request the app will need, saves the raw replies, and logs out at the end.
- **The user types the device password at a hidden prompt** (`getpass`), so it never appears in chat, files or shell history. Never ask for it in chat.
- Save raw output to a git-ignored folder. An ignore rule without a leading `/` matches at any depth, which matters when the tool runs from a subfolder.

## 3. Redact before anything becomes a fixture

Raw replies contain the device's MAC, serial number and the user's public IP. They may also contain account details. Before anything goes into `tests/fixtures/`:
- MACs → `00:00:5E:00:53:xx` (the documentation range)
- serial numbers → zeros
- public IPv4 → `203.0.113.x`; IPv6 → `2001:db8::`
- the same input maps to the same replacement however it is written (colons, dashes, case)

Better: have the capture tool redact before it saves, and produce a zip ready to attach to an issue, so other users can contribute their model. Put a README in the fixture folder with the model, firmware, date and the state of the line at capture time. Test the redaction itself (`tests/capture.test.py`).

## 4. Measure the device's rules on real hardware

These facts decide the design and are rarely written down. Measure them and record them in CLAUDE.md:
- **Session lifetime:** probe with idle gaps of 1, 2, 5, 10, 15, 20 and 30 minutes. One modem kept a session alive while it was used and expired it after 10–15 minutes idle.
- **What an expired session returns.** It may not be 401: one modem answered 404.
- **Whether several sessions can be open at once**, so the router and a browser don't log each other out.
- **Ordering and rate rules.** One modem answered 403 to any request whose timestamp was lower than one it had already accepted. Busybox `date` has no milliseconds, so take them from `ucode` `clock()`. Keep the last value in `/var/run/<id>/` and never send a lower one.
- **The size of any log the device keeps** (one held only 100 entries, about 2 hours on a bad line), and whether a login adds an entry to it.
- **Which counters are cumulative since boot, and how a restart shows up.** A device can also re-register without its uptime resetting.

`APP_LIB=1 . /usr/bin/<id>` loads the backend's functions on the router for probes like these.

## 5. Design from those rules

- Keep one session open between checks if logins are logged or limited. Re-login on the device's "expired" reply.
- Poll a short device log often enough to catch every entry, and de-duplicate it across polls.
- Store the change in a counter since the previous good reading. Detect a device restart when its uptime is shorter than the time since the previous good check, with about 2 minutes' grace. After a restart, the change is the new count.
- Date device log entries by the device's clock, corrected by the measured offset, not by when you first saw them. First-seen dates inflated per-day rates.
- Tell "the line is down" (no answer from the internet) apart from "the device restarted" and from "the device didn't answer". Each gets its own stored reason.
- Map transport failures to distinct reasons the UI explains:
  - curl exit 6/7 → unreachable
  - curl exit 28 → timeout
  - curl exit 35/60 → tls_error
  - HTTP status codes → `http_<code>`
  - a refused login → login_refused
  - no password saved → no_password
  - something answered, but not the expected device → not_a_supported_device
- Settings should offer a "Test connection" button that logs in with what is typed, reads once, stores nothing and logs out.

## 6. Your testing can damage the evidence

If every login writes an entry to a 100-entry device log, about 40 manual checks push real events out of it. Tell the user, keep manual checks against the real device to a minimum, and prefer the fake. Before real data collection starts, delete readings from the testing period, including failures caused by your own bugs, so they never reach a report.

## 7. Build the fake device

See `testing.md` §4. It replays the redacted captures, checks every request with the real algorithm, and enforces the rules from §4 above. Scenario endpoints cover wrong password, unreachable, session drop, restart, counter growth and log overwrite. The real backend runs against it in the OpenWrt container. Prove each rule's test can fail: take the client's fix out and see the fake reject it the same way the device did.
