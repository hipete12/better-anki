# Anki feature research & parity

Research sources: the Anki manual's feature set, Anki's own protobuf definitions (`proto/anki/{notetypes,decks,deck_config,import_export}.proto`, used to decode schema-18 collections), and the reference FSRS-6 implementation (`open-spaced-repetition/ts-fsrs`, `models/fsrs-6`).

Legend: ✅ implemented · 🟡 partial · ⛔ not implemented (yet)

## Scheduling

| Anki feature | Status | Notes |
|---|---|---|
| Card states new / learning / review / relearning; queues incl. buried, suspended, interday learning, preview | ✅ | Same numeric semantics as Anki, so imports round-trip |
| Learning & relearning steps (minutes/hours/days), Hard = average of steps, interday steps | ✅ | |
| SM-2 (v3 scheduler): graduating/easy interval, starting ease, easy bonus, interval modifier, hard interval, new interval, min/max interval, early reviews | ✅ | |
| **FSRS-6** memory model (21 params, short-term stability, decay `w20`) | ✅ | FSRS-4.5/5 parameters are migrated |
| Desired retention (per preset, per-deck override) | ✅ | |
| FSRS parameter optimizer | ✅ | Adam with finite-difference gradients, run in a worker thread; reports log loss/RMSE vs defaults |
| Reschedule cards on parameter change, compute memory state from history when enabling FSRS | ✅ | |
| Fuzz (Anki's ranges) | ✅ | Deterministic per card+rep, so button labels match the result |
| Load balancer, easy days | ✅ | Picks the quietest day in the fuzz range, weighted by per-weekday load |
| Daily limits per deck with parent limits, new-cards-ignore-review-limit, today-only extensions | ✅ | |
| Display order: gather order, sort order, new/review mix, interday mix, review order (incl. retrievability, relative overdueness) | ✅ | |
| Bury new/review/interday siblings, unbury on day rollover | ✅ | |
| Leech threshold & action (tag/suspend) | ✅ | |
| Next-day-starts-at, learn-ahead limit, timebox | ✅ | |
| Filtered decks (2 search terms, 11 orders, reschedule or preview with custom delays), rebuild/empty | ✅ | |
| Custom study (extend limits, forgotten, review ahead, preview new, by state/tag) | ✅ | |
| Set due date (ranges, `!`), forget/reset, reposition new cards | ✅ | |
| Undo (review, edits, bulk actions, tags) | ✅ | 50-step server-side stack |
| Compute optimal retention / workload simulator | 🟡 | Simple API estimate, no UI yet |

## Notes, templates, rendering

| Anki feature | Status | Notes |
|---|---|---|
| Stock note types: Basic, reversed, optional reversed, type-in, Cloze, Image Occlusion | ✅ | |
| Custom note types: fields (rename/reorder/add/delete, sticky, RTL, plain text, exclude from search, description, sort field), card templates, CSS | ✅ | Note data and card ordinals are migrated on change |
| Template syntax: `{{Field}}`, `{{#}}`/`{{^}}`, `{{FrontSide}}`, `text:`, `hint:`, `type:`, `cloze:`, `cloze-only:`, `furigana:`/`kana:`/`kanji:`, `nc:`, `tts`, special fields (Tags, Deck, Subdeck, Card, CardFlag, Type) | ✅ | TTS uses the Web Speech API |
| Cloze incl. hints, multiple ordinals (`c1,2`) and **nested** clozes | ✅ | |
| Type-in-the-answer comparison | ✅ | Character-level diff like Anki |
| Image occlusion review (imported Anki IO notes) | ✅ | Masks drawn on canvas; IO *editor* ⛔ |
| Audio/video `[sound:]`, autoplay, replay, skip question audio | ✅ | |
| Math: MathJax `\( \)`/`\[ \]`; `[latex]`/`[$]` | 🟡 | `[latex]` is rendered through MathJax; there's no TeX toolchain |
| Card generation rules / empty cards check | ✅ | |
| Duplicate detection (first field) | ✅ | |
| Rich editor: formatting, colors, lists, cloze shortcuts, paste/drag images, **record audio**, HTML editor | ✅ | Web; Android has a plain-text editor with a cloze helper |
| Change note type | 🟡 | API only |
| Find & replace (regex, per field, tags) | ✅ | |

## Browser & search

| Anki feature | Status |
|---|---|
| Search syntax: text, wildcards `*`/`_`, `"phrases"`, `-`, `or`, groups, `deck:` (incl. subdecks, `current`, `filtered`), `note:`, `card:`, `tag:` (hierarchical, `none`), `is:` (new/learn/review/due/suspended/buried/…), `flag:`, `field:value`, `w:`, `re:`, `nc:`, `dupe:`, `nid:`/`cid:`/`mid:`/`did:`, `preset:`, `added:`, `edited:`, `rated:n[:ease]`, `resched:`, `introduced:`, `prop:` (ivl, due, pos, reps, lapses, ease, s, d, r) | ✅ |
| Cards/notes mode, configurable sortable columns, multi-select, sidebar (saved searches, states, flags, decks, note types, tags) | ✅ |
| Bulk: change deck, suspend, bury, flags (7), mark, tags, set due, forget, reposition, delete, export, create filtered deck | ✅ |
| Card info (stats + full review history, FSRS state) | ✅ |
| Tag rename/delete/clear unused | ✅ (API; rename/delete UI ⛔) |

## Import / export

| Format | Status |
|---|---|
| `.apkg` legacy (`collection.anki2`/`.anki21`, JSON media map) | ✅ |
| `.apkg`/`.colpkg` latest (`collection.anki21b`, zstd, protobuf media map, schema 18) | ✅ |
| Merge by GUID, update if newer/always/never, keep scheduling & review log & FSRS state, deck presets, media de-duplication with rename on conflict | ✅ |
| Text/CSV with Anki headers (`#separator`, `#html`, `#columns`, `#tags column`, …), field mapping, duplicate handling | ✅ |
| Export `.apkg` (with/without scheduling & media), notes as text | ✅ |
| AnkiWeb sync protocol | ⛔ by design: the server is the sync hub. Move data via `.apkg` |

## Statistics

Today summary, calendar heatmap, streaks, review history by type, future due forecast, card counts, intervals, ease, FSRS difficulty/stability/retrievability, hourly breakdown, answer buttons, cards added, true retention table, per-deck and range filters. Every chart has a table view. ✅

## Maintenance

Check database, empty cards, check media (unused/missing), automatic encrypted backups. ✅

## Clients

| Capability | Web | Android |
|---|---|---|
| Sign-in/setup, transport security indicator, device list & revoke | ✅ | ✅ |
| Deck list (tree, counts), create | ✅ | ✅ |
| Deck rename/delete/options/export, filtered decks, custom study | ✅ | ⛔ (use web) |
| Study (all card types, audio, typed answers, flags, mark, bury, suspend, undo, edit) | ✅ | ✅ |
| Add / edit notes | ✅ rich | ✅ plain text |
| Browse | ✅ full | 🟡 search + edit |
| Stats | ✅ full | 🟡 summary, heatmap, forecast, retention |
| Note types, deck options, import, maintenance | ✅ | ⛔ (use web) |
| Offline study | ⛔ | ⛔ |

## Not planned / known gaps

Add-ons, multiple profiles (one account and collection per server), offline mode, the image-occlusion editor, a tag management UI, and a change-note-type UI.
