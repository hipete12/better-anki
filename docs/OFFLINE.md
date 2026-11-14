# Offline study

Study on a device without a connection, then sync the reviews back to the server. Android first; the server side is client-agnostic.

## Goals and limits

- Offline you can **study** the decks you downloaded: answer, undo, bury, suspend, flag and mark.
- Adding or editing notes, filtered decks and browsing stay online-only.
- Type-in answers show the correct answer offline but aren't compared character by character.
- The server stays the single source of truth. It **replays** offline reviews through its own scheduler, so intervals and stats come out exactly as if you had studied online at those times.

## Versions

The server keeps a **sync version**: a counter, not a clock. Device clocks drift and two changes can share a millisecond, so a counter is the only reliable way to ask "has this changed since I last synced?".

- Every card insert or update, and every review-log insert, stamps that row's `usn` with the current version. SQLite triggers do this, so every code path is covered: answering, undo, the browser, imports and maintenance.
- The version goes up whenever a device downloads offline cards, and after every sync. The device remembers the version it downloaded at (its **base**). On the server, anything with `usn > base` changed after that device went offline.

## Download (`POST /api/offline/pack`)

The device picks decks. The server returns:

- `base`, the server time, the server's timezone offset and rollover hour, so the device computes "today" the same way the server does
- the deck options and today's study counts per deck, so daily limits carry over
- every card the device might study in the next few days: due reviews, learning cards, and new cards up to the daily limit for each day. Each comes with its scheduling state and pre-rendered question and answer pages.
- the media files those cards use. The device downloads them through the normal signed media URLs.

On the device, everything is encrypted with a non-exportable Android Keystore key, the same way the session token already is.

## Studying offline

The device runs a port of the scheduler (`server/src/sched/scheduler.ts`). It uses it only for button labels and to decide when learning cards come back. Each action is appended to a local log:

```
{ id, kind: "answer", cardId, ease, at, timeMs }    at = device clock, ms
{ id, kind: "bury" | "buryNote" | "suspend" | "suspendNote", cardId, at }
{ id, kind: "flag", cardId, flag, at }
{ id, kind: "mark", cardId, marked, at }
```

Undo removes the last entry and restores the device's copy of the card. The server only ever sees actions you kept.

## Sync (`POST /api/offline/sync`)

The request contains `syncId`, `base`, the device clock at send time, the log, and the device's base copy of every card the log touches.

1. **Clock correction.** `offset = server now − device clock at send`. Each action's time is moved by `offset`, then clamped between the download time and now. This keeps review dates right even if the phone's clock is off.
2. **Classify each touched card.**
   - Unchanged on the server (`usn ≤ base`): **merged automatically**, with no prompt.
   - Changed on the server since `base`: a **conflict**.
   - Deleted on the server: its offline actions are dropped and reported, since there's nothing to apply them to.
   - Changes on the server to *other* cards never cause a prompt.
3. **Preview** (`dryRun: true`). For every conflict, the server lists what happened on each side:
   - Server: reviews since base, suspend/bury, flag, deck move, reset, set due date
   - Offline: the logged actions

   It also shows the card's resulting state under each choice. To get those, it runs each choice inside a transaction that is rolled back.
4. **Choices per conflicting card:**
   - **Merge both** (default): restore the base copy, then replay the server's reviews since base together with the offline reviews, oldest first. Both reviews really happened, so this gives the most accurate memory model. Flag and suspend/bury follow whichever side changed them last. Server-side resets and set-due-date on that card are replaced by the replay; the preview shows this.
   - **Use offline**: restore the base copy, remove the server's reviews of that card since base, and replay the offline actions.
   - **Keep server**: drop the offline actions for that card.
5. **Commit.** All of it happens in one transaction. If the server changed again between preview and commit and a new conflict has no choice yet, the commit is refused with a fresh preview (409).
6. **Idempotent.** The result is stored under `syncId`. If the connection drops after the server applied a sync, the retry gets the stored result instead of recording the reviews twice.
7. **Afterwards.** The response includes the current state of every downloaded card that changed since the base, and the new base. The device updates its copy straight away, so it stays consistent even if the follow-up re-download fails. The device keeps its original download time as the lower bound for review times, because actions still in the log were recorded before this sync. It then re-downloads in the background for fresh due cards.

Replay uses the normal answer path at the review's corrected time. Revlog ids and today's counts use that time, and sibling burying and leech handling apply as usual. Replay doesn't add to the server's undo stack.

## Android client

- **Download:** on a deck's page, choose **Download**. Downloaded decks stay current: the app re-downloads after each sync and every few hours when online.
- **Going offline:** when the server can't be reached, the deck list shows your downloaded decks and studying uses the downloaded copy. The study screen shows an "Offline" banner. If the connection drops mid-session, the app switches over without losing the answer you just gave.
- **Syncing:** happens automatically when the server is reachable and no offline session is open. A banner on the deck list shows actions waiting to sync, or conflicts to review.
- **Storage:** on the device, the pack, the action log and media are encrypted with a random data key wrapped by a non-exportable Android Keystore key. Signing out removes them; Settings warns first if anything hasn't synced.
- **Batches:** a batch keeps its id and size until the server confirms it, so retries are idempotent even if the app is killed mid-sync.

## Testing

- **Server:** `cd server && bun test` covers change tracking, packs, clean replay, clock correction, idempotent retries, each conflict choice, deleted cards and the HTTP API (`test/offline.test.ts`).
- **Scheduler port:** `cd android && ./gradlew testDebugUnitTest` checks the Kotlin scheduler against 144 vectors from the server's own scheduler, 576 outcomes in all (regenerate them with `bun scripts/sched-vectors.ts`). It also covers the offline queue (`OfflineEngineTest`).
- **End to end:** done on an emulator against a local server: download, stop the server, study offline (including undo and media), change the same cards on the server, then resolve the conflicts and check the review log.
