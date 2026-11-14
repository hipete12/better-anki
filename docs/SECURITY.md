# Security model

Goal: encrypt as much as possible without giving up a server that schedules, searches and renders on behalf of thin clients.

## What is protected, and how

| Data | Protection |
|---|---|
| Collection (notes, cards, review log, decks, config) | SQLite runs **in memory only**. On disk it exists only as zstd-compressed, **AES-256-GCM** sealed snapshots (`collection.enc`), written atomically every ~1.5 s when something changed, with the previous snapshot kept as `.prev`. |
| Media files | Each file is sealed with AES-256-GCM, with the filename bound as associated data. On-disk names are `HMAC-SHA256(key, filename)`, so filenames (which often reveal content) don't leak. |
| Backups | Daily (and pre-import) encrypted snapshots in `backups/*.enc`. |
| Imports | `.apkg`/`.colpkg` files are unzipped and opened **in memory** (`sqlite3_deserialize`). No plaintext copy is ever written to disk. Exports are also built in memory. |
| Account & devices (`auth.json`) | Contains only: scrypt parameters, the data key wrapped per password and per device, SHA-256 hashes of tokens and usernames, and AES-GCM sealed metadata (device names, IPs, timestamps, username). |
| In transit | Tailscale (WireGuard) between devices; optional TLS (`BA_TLS_CERT`/`BA_TLS_KEY`, e.g. `tailscale cert`). Bearer tokens only travel in the `Authorization` header and never in URLs. Media URLs carry a short-lived (12 h) HMAC-signed token bound to the device session. |
| Web client | The session token is encrypted with a **non-extractable** WebCrypto AES-GCM key kept in IndexedDB. Outside a secure context the token is kept for the current tab only. Card templates (which can contain scripts from shared decks) run in a sandboxed iframe **without `allow-same-origin`**, so they can't reach the app's storage or token. CSP, `no-referrer` and `nosniff` headers are set. |
| Android client | The token is encrypted with a non-exportable **Android Keystore** AES-256-GCM key. App backup and device transfer are disabled. The card WebView has file/content access disabled and no disk cache (the server sends `Cache-Control: no-store`). External links require confirmation. Plain HTTP is refused unless the host is loopback, the emulator host or Tailscale, or the user explicitly opts in. |

## Key custody

```
           password ──scrypt(N=2^15)──► KEK_pw ─┐
device token (256-bit) ──HKDF──► KEK_dev ───────┼──► unwrap ──► DEK (random 256-bit, memory only)
                                                │
DEK ──HKDF──► collection key · media content key · media name key · media URL key · auth-meta key
```

- The DEK is generated at setup and **never stored unwrapped**.
- After a restart the server is **locked**: it can't read anything until a user signs in with the password or an authorized device makes a request with its token. The token holds the material that unwraps the DEK, and the server only stores its hash.
- Revoking a device deletes its wrapped DEK. Changing the password re-wraps the DEK; data does not need re-encrypting.
- Failed logins are rate limited per IP with exponential backoff. GCM authentication doubles as password verification, and timing is equalised for unknown usernames.
- First-run setup from a non-loopback address requires the one-time setup code printed in the server console, so a tailnet peer can't claim a fresh server.

## Limits and trade-offs (honest list)

- **Not end-to-end encrypted.** The server must see plaintext in memory to schedule, search and render cards. Someone with root on the running server can read memory. The design protects data at rest (stolen disk, backups, snapshots) and in transit.
- Exported `.apkg`/text files are plaintext, because Anki can't read encrypted packages.
- A crash can lose up to ~1.5 s of changes (the snapshot interval).
- Forgetting the password loses the data unless an authorized device is still signed in (it can unlock the server and export).
- Over plain `http://` to a Tailscale IP, browsers don't treat the page as a secure context, so web credentials are session-only. Use `tailscale cert` / HTTPS for persistent encrypted web sign-in.
- Card pages load MathJax from jsdelivr when a card contains math (no user data is sent).
