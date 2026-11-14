# Better Anki

A self-hosted re-implementation of [Anki](https://apps.ankiweb.net) built around one server that owns everything: decks, notes, scheduling, review history and media. Thin clients connect to it over your Tailscale network:

| Component | Stack | Path |
|---|---|---|
| **Server** | Bun + TypeScript, SQLite (in memory, encrypted snapshots on disk) | `server/` |
| **Web app** | React 18 + Vite + Tailwind 4 | `web/` (served by the server at `/`) |
| **Android app** | Kotlin + Jetpack Compose | `android/` |

All scheduling, template rendering, search and import/export logic runs on the server, so every client behaves the same. The server is the single source of truth, so there are no sync conflicts. Changes show up live on every connected device.

Highlights over stock Anki:
- **Encrypted by design.** The collection, media, filenames and backups are AES-256-GCM encrypted at rest, and the key only ever exists in server memory. See [docs/SECURITY.md](docs/SECURITY.md).
- **FSRS-6 by default**, with a built-in parameter optimizer, plus a load balancer and easy days. Classic SM-2 is still available.
- **Real-time multi-device.** Answer a card on your phone and the web dashboard updates instantly.
- A modern, responsive UI with dark mode, keyboard-first study and a richer stats dashboard (heatmap, streaks, true retention, FSRS stability/difficulty/retrievability).
- Reads every Anki package format, legacy and current (`.apkg`, `.colpkg`, `collection.anki21b` with zstd and protobuf). Exports `.apkg` files that Anki, AnkiDroid and AnkiMobile can import, verified against the official `anki` library.

See [docs/FEATURES.md](docs/FEATURES.md) for the Anki feature research and the parity matrix.

## Quick start (localhost)

```bash
# 1. Server (also serves the built web app)
cd server && bun install
cd ../web && bun install && bun run build
cd ../server && bun start            # http://localhost:8765
```

Open http://localhost:8765 and create your account. Your password protects the encryption key and **can't be recovered**. From localhost no setup code is needed. A remote device setting up the server for the first time must enter the setup code printed in the server console.

Web development with hot reload: `cd web && bun run dev` (http://localhost:5173, proxies `/api` and `/media` to the server).

### Server options (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `BA_DATA` | `server/data` | Data directory (encrypted collection, media, backups, `auth.json`) |
| `BA_PORT` | `8765` | Port |
| `BA_HOST` | `0.0.0.0` | Bind address (reachable by Tailscale peers) |
| `BA_TLS_CERT` / `BA_TLS_KEY` | – | Serve HTTPS (e.g. certs from `tailscale cert`) |
| `BA_WEB` | `web/dist` | Built web app to serve |

### Using it over Tailscale

Clients connect to `http://<tailscale-ip>:8765` (100.x.y.z) or your MagicDNS name. Tailscale traffic is WireGuard-encrypted end to end. For HTTPS on your tailnet (this also lets the browser encrypt saved credentials, since WebCrypto needs a secure context):

```bash
tailscale cert my-host.tailnet-name.ts.net
BA_TLS_CERT=my-host.tailnet-name.ts.net.crt BA_TLS_KEY=my-host.tailnet-name.ts.net.key bun start
```

## Android app

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Prebuilt, signed APKs are attached to the GitHub releases. For your own signed release build, create `android/keystore.properties` (gitignored) with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`, then run `./gradlew assembleRelease`. Without that file, release builds are signed with the debug key.

On the emulator, the host's localhost is `http://10.0.2.2:8765` (the default on the connect screen). On a phone, use the server's Tailscale address. The app refuses plain-HTTP servers that aren't loopback, the emulator host or Tailscale unless you explicitly allow it.

## Tests

```bash
cd server && bun test                     # 31 tests: scheduler, FSRS, templates, search,
                                          # import/export (real Anki fixtures), encryption, auth, HTTP API
cd e2e && bun install
bun ui-smoke.mjs http://localhost:8765 ./shots ../server/test/fixtures/modern.apkg   # drives the web UI (fresh server)
```

`server/test/make_fixtures.py` regenerates the Anki fixtures with the official `anki` Python package. `server/test/check_anki_import.py` confirms that official Anki can import our exported `.apkg`.

## Repository layout

```
server/src/
  index.ts            HTTP server, auth endpoints, lock/unlock lifecycle, media, SSE
  crypto/             AES-GCM/HKDF/scrypt primitives, encrypted storage, key custody & sessions
  collection.ts       decks, presets, note types, notes, cards, tags
  sched/              FSRS-6, SM-2 scheduler, queues/limits/burying/undo, optimizer
  render/             template engine, cloze (nested + image occlusion), card page builder
  search.ts           Anki search syntax
  importer/ exporter/ .apkg/.colpkg/CSV import, .apkg/text export
  ops.ts stats.ts maintenance.ts
web/src/              pages (Decks, Study, Add, Browse, Stats, Options, Note types, Settings) + components
android/app/src/main/java/com/betteranki/app/   data (API, Keystore store) + ui (Compose screens)
```
