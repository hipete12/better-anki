// Offline study: change tracking, packs, and syncing offline actions (docs/OFFLINE.md).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection } from "../src/collection";
import { randomKey } from "../src/crypto/aead";
import { buildPack, syncOffline, syncVersion, type OfflineEvent, type SyncRequest } from "../src/offline";
import { answerCard } from "../src/sched/queue";
import { computeOutcomes } from "../src/sched/scheduler";
import type { CardRow } from "../src/types";

let dir: string;
let col: Collection;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ba-offline-"));
  col = new Collection(dir, randomKey(), { autoFlush: false });
  col.setConfig({ loadBalancer: false }); // deterministic intervals, so replays can be compared with direct answers
});
afterEach(() => {
  col.close();
  rmSync(dir, { recursive: true, force: true });
});

const HOUR = 3600_000;
const render = () => ({ question: "<q>", answer: "<a>", hasTypeAnswer: false, questionText: "q" });
const basic = () => col.notetypeByName("Basic")!.id;
type Synced = CardRow & { usn: number };
const card = (id: number) => col.card(id) as Synced;
const revlog = (cid: number) => col.db.query<{ id: number; ease: number; usn: number }, [number]>("SELECT id, ease, usn FROM revlog WHERE cid = ? ORDER BY id").all(cid);

/** A deck with `n` notes; the first `reviews` cards are review cards due today. */
function setup(n = 4, reviews = 2, name = "Spanish") {
  const did = col.ensureDeck(name).id;
  for (let i = 0; i < n; i++) col.addNote(basic(), [`${name} ${i}`, `a${i}`], [], did);
  const ids = col.db.query<{ id: number }, [number]>("SELECT id FROM cards WHERE did = ? ORDER BY id").all(did).map((r) => r.id);
  const today = col.today();
  for (const id of ids.slice(0, reviews)) col.db.query("UPDATE cards SET type=2, queue=2, ivl=10, due=?, factor=2500, reps=3 WHERE id=?").run(today, id);
  return { did, ids };
}

/** Download, pretending it happened `ago` ms in the past (so offline review times fit in the window). */
function pack(deckIds: number[], ago = 2 * HOUR) {
  const p = buildPack(col, { deckIds, days: 7 }, render, "http://x/media/t/");
  return { ...p, serverTime: p.serverTime - ago };
}

let seq = 0;
function request(p: ReturnType<typeof pack>, events: Omit<OfflineEvent, "id">[], extra: Partial<SyncRequest> = {}): SyncRequest {
  const touched = new Set(events.map((e) => e.cardId));
  return {
    syncId: `sync-${++seq}`,
    base: p.base,
    packTime: p.serverTime,
    deviceNow: Date.now(),
    events: events.map((e, i) => ({ id: `e${i}`, ...e })),
    baseCards: p.cards.filter((c) => touched.has(c.id)),
    ...extra,
  };
}

describe("change tracking", () => {
  test("card and review-log changes are stamped with the sync version", () => {
    const { ids } = setup(2, 0);
    const v = syncVersion(col);
    expect(card(ids[0]).usn).toBe(v);
    const p = pack([1]);
    expect(p.base).toBe(v);
    expect(syncVersion(col)).toBe(v + 1);
    // a real change bumps usn; an mtime-only touch doesn't
    col.db.query("UPDATE cards SET mtime = mtime + 5 WHERE id = ?").run(ids[0]);
    expect(card(ids[0]).usn).toBe(v);
    col.db.query("UPDATE cards SET flags = 1 WHERE id = ?").run(ids[0]);
    expect(card(ids[0]).usn).toBe(v + 1);
    answerCard(col, ids[1], 3, 1000);
    expect(card(ids[1]).usn).toBe(v + 1);
    expect(revlog(ids[1])[0].usn).toBe(v + 1);
  });
});

describe("pack", () => {
  test("cards to study in the window, with options and today's counts", () => {
    const { did, ids } = setup(6, 3);
    const today = col.today();
    col.db.query("UPDATE cards SET due = ? WHERE id = ?").run(today + 30, ids[1]); // review beyond the window
    col.db.query("UPDATE cards SET queue = -1 WHERE id = ?").run(ids[2]); // suspended
    col.db.query("UPDATE cards SET type=1, queue=1, due=?, left=2 WHERE id = ?").run(Math.floor(Date.now() / 1000) + 60, ids[3]); // learning
    setup(2, 1, "Other");
    answerCard(col, ids[0], 3, 1000);
    const p = buildPack(col, { deckIds: [did], days: 7 }, render, "http://x/media/t/");
    // ids[0] was just answered (now due in weeks), ids[1] is due after the window, ids[2] is suspended
    expect(p.cards.map((c) => c.id).sort()).toEqual([ids[3], ids[4], ids[5]].sort());
    expect(p.cards.every((c) => c.question === "<q>")).toBe(true);
    expect(p.deckConfigs).toHaveLength(1);
    expect(p.deckToday.find((t) => t.did === did)?.rev_done).toBe(1);
    expect(p.decks.map((d) => d.name)).toEqual(["Spanish"]);
  });
  test("pages carry night-mode placeholders", async () => {
    const { buildCardPage, NIGHT_TOKENS } = await import("../src/render/page");
    const html = buildCardPage({ html: "x", css: "", ord: 0, night: false, mediaBase: "/m/", autoplay: false, side: "question", nightTokens: true });
    expect(html).toContain(NIGHT_TOKENS.html);
    expect(html).toContain(NIGHT_TOKENS.card);
  });
});

describe("sync", () => {
  test("clean sync replays reviews at their real time, corrected for the device clock", () => {
    const { did, ids } = setup(3, 1);
    const p = pack([did]);
    const before = card(ids[0]);
    // the device clock runs an hour behind; it reviewed 30 minutes before sending
    const deviceNow = Date.now() - HOUR;
    const at = deviceNow - 30 * 60_000;
    const r = syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 3, at, timeMs: 4000 }], { deviceNow }));
    expect(r).toMatchObject({ status: "ok", reviews: 1, autoMerged: 1, newBase: p.base + 1 });
    const [rev] = revlog(ids[0]);
    expect(Math.abs(rev.id - (Date.now() - 30 * 60_000))).toBeLessThan(5000);
    const expected = computeOutcomes(col, before, Math.floor(rev.id / 1000))[3].card;
    expect(card(ids[0])).toMatchObject({ type: expected.type, queue: expected.queue, ivl: expected.ivl, due: expected.due, reps: before.reps + 1 });
    expect(col.db.query<{ n: number }, [number, number]>("SELECT rev_done n FROM deck_today WHERE did=? AND day=?").get(did, col.today())?.n).toBe(1);
  });

  test("a retried sync isn't applied twice", () => {
    const { did, ids } = setup(2, 1);
    const p = pack([did]);
    const req = request(p, [{ kind: "answer", cardId: ids[0], ease: 3, at: Date.now() - 60_000 }]);
    const first = syncOffline(col, req);
    const again = syncOffline(col, req);
    expect(again).toMatchObject({ ...first, repeated: true });
    expect(revlog(ids[0])).toHaveLength(1);
  });

  test("server changes to other cards don't cause a prompt", () => {
    const { did, ids } = setup(3, 2);
    const p = pack([did]);
    answerCard(col, ids[1], 3, 1000); // studied on the web meanwhile
    const r = syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 4, at: Date.now() - 60_000 }]));
    expect(r).toMatchObject({ status: "ok", autoMerged: 1, resolved: [] });
  });

  test("other offline actions: bury, suspend, flag, mark", () => {
    const { did, ids } = setup(4, 0);
    const p = pack([did]);
    const t = Date.now() - 60_000;
    syncOffline(col, request(p, [
      { kind: "bury", cardId: ids[0], at: t },
      { kind: "suspend", cardId: ids[1], at: t + 1 },
      { kind: "flag", cardId: ids[2], flag: 2, at: t + 2 },
      { kind: "mark", cardId: ids[3], marked: true, at: t + 3 },
    ]));
    expect(card(ids[0]).queue).toBe(-3);
    expect(card(ids[1]).queue).toBe(-1);
    expect(card(ids[2]).flags).toBe(2);
    expect(col.note(card(ids[3]).nid)!.tags.trim()).toBe("marked");
  });

  test("a card changed on both sides is a conflict: nothing changes until you choose", () => {
    const { did, ids } = setup(2, 2);
    const p = pack([did]);
    answerCard(col, ids[0], 3, 1000); // server: Good, just now
    const serverState = card(ids[0]);
    const req = request(p, [
      { kind: "answer", cardId: ids[0], ease: 1, at: Date.now() - 10 * 60_000 }, // offline: Again, earlier
      { kind: "answer", cardId: ids[1], ease: 3, at: Date.now() - 9 * 60_000 }, // unrelated card
    ]);
    const r = syncOffline(col, req) as any;
    expect(r.status).toBe("conflicts");
    expect(r.autoMerged).toBe(1);
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0];
    expect(c.cardId).toBe(ids[0]);
    expect(c.question).toBe("Spanish 0");
    expect(c.server.map((x: any) => x.text)).toEqual(["Reviewed · Good"]);
    expect(c.offline.map((x: any) => x.text)).toEqual(["Reviewed · Again"]);
    expect(Object.keys(c.outcomes).sort()).toEqual(["merge", "offline", "server"]);
    expect(c.outcomes.offline).toMatch(/^Relearning/);
    expect(c.outcomes.server).toMatch(/^Review/);
    // nothing applied, including the unrelated card, and the dry runs left no trace
    expect(card(ids[0])).toEqual(serverState);
    expect(revlog(ids[0])).toHaveLength(1);
    expect(revlog(ids[1])).toHaveLength(0);
  });

  test("keep server: offline actions for that card are dropped", () => {
    const { did, ids } = setup(2, 2);
    const p = pack([did]);
    answerCard(col, ids[0], 3, 1000);
    const serverState = card(ids[0]);
    const r = syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 1, at: Date.now() - 60_000 }], { resolutions: { [ids[0]]: "server" } }));
    expect(r).toMatchObject({ status: "ok", resolved: [{ cardId: ids[0], resolution: "server" }] });
    expect(card(ids[0])).toMatchObject({ type: serverState.type, ivl: serverState.ivl, due: serverState.due, reps: serverState.reps });
    expect(revlog(ids[0]).map((x) => x.ease)).toEqual([3]);
  });

  test("use offline: the server's review is removed and the offline one replayed from the base copy", () => {
    const { did, ids } = setup(1, 1);
    const p = pack([did]);
    const base = card(ids[0]);
    answerCard(col, ids[0], 3, 1000);
    const at = Date.now() - 60_000;
    syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 1, at }], { resolutions: { [ids[0]]: "offline" } }));
    expect(revlog(ids[0]).map((x) => x.ease)).toEqual([1]);
    const expected = computeOutcomes(col, base, Math.floor(at / 1000))[1].card;
    expect(card(ids[0])).toMatchObject({ type: expected.type, lapses: base.lapses + 1, reps: base.reps + 1 });
  });

  test("merge both: both reviews replayed oldest first", () => {
    const { did, ids } = setup(1, 1);
    const p = pack([did]);
    const base = card(ids[0]);
    answerCard(col, ids[0], 3, 1000); // server, now
    const serverRev = revlog(ids[0])[0];
    const at = Date.now() - 20 * 60_000; // offline, earlier
    syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 1, at }], { resolutions: { [ids[0]]: "merge" } }));
    const revs = revlog(ids[0]);
    expect(revs.map((x) => x.ease)).toEqual([1, 3]);
    expect(revs[1].id).toBe(serverRev.id); // the server's review keeps its time
    // same result as answering Again then Good online at those times
    const afterAgain = computeOutcomes(col, base, Math.floor(at / 1000))[1].card;
    const afterGood = computeOutcomes(col, afterAgain, Math.floor(serverRev.id / 1000))[3].card;
    expect(card(ids[0])).toMatchObject({ type: afterGood.type, queue: afterGood.queue, ivl: afterGood.ivl, reps: base.reps + 2, lapses: base.lapses + 1 });
  });

  test("merge keeps a suspension made on the server", () => {
    const { did, ids } = setup(1, 1);
    const p = pack([did]);
    col.db.query("UPDATE cards SET queue = -1 WHERE id = ?").run(ids[0]);
    const r = syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 3, at: Date.now() - 60_000 }])) as any;
    expect(r.conflicts[0].server.map((x: any) => x.text)).toEqual(["Suspended"]);
    expect(r.conflicts[0].outcomes.merge).toBe("Suspended");
    syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 3, at: Date.now() - 60_000 }], { resolutions: { [ids[0]]: "merge" } }));
    expect(card(ids[0]).queue).toBe(-1);
    expect(revlog(ids[0])).toHaveLength(1);
  });

  test("cards deleted on the server are dropped and reported", () => {
    const { did, ids } = setup(2, 1);
    const p = pack([did]);
    col.removeNotes([card(ids[0]).nid]);
    const r = syncOffline(col, request(p, [
      { kind: "answer", cardId: ids[0], ease: 3, at: Date.now() - 60_000 },
      { kind: "answer", cardId: ids[1], ease: 3, at: Date.now() - 50_000 },
    ]));
    expect(r).toMatchObject({ status: "ok", reviews: 1, dropped: [{ cardId: ids[0], reason: "deleted", actions: 1 }] });
  });

  test("a card that changes between preview and commit asks again", () => {
    const { did, ids } = setup(1, 1);
    const p = pack([did]);
    const events = [{ kind: "answer" as const, cardId: ids[0], ease: 3, at: Date.now() - 60_000 }];
    expect(syncOffline(col, request(p, events, { dryRun: true }))).toMatchObject({ status: "preview", conflicts: [] });
    answerCard(col, ids[0], 2, 1000);
    expect(syncOffline(col, request(p, events))).toMatchObject({ status: "conflicts" });
  });

  test("times from a fast device clock are capped at now", () => {
    const { did, ids } = setup(1, 1);
    const p = pack([did]);
    const deviceNow = Date.now() + 5 * HOUR; // clock 5h fast...
    syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 3, at: deviceNow + HOUR }], { deviceNow })); // ...and an event "after" sending
    expect(revlog(ids[0])[0].id).toBeLessThanOrEqual(Date.now());
  });

  test("bad requests are refused", () => {
    const { did, ids } = setup(1, 1);
    const p = pack([did]);
    expect(() => syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 7, at: Date.now() }]))).toThrow("Invalid ease");
    expect(() => syncOffline(col, { ...request(p, []), syncId: "" })).toThrow("sync id");
    answerCard(col, ids[0], 3, 1000);
    expect(() => syncOffline(col, request(p, [{ kind: "answer", cardId: ids[0], ease: 3, at: Date.now() }], { baseCards: [] }))).toThrow("copy of a changed card");
  });
});

describe("offline HTTP API", () => {
  test("download (gzip) and sync through the authenticated API", async () => {
    const { createServer } = await import("../src/index");
    const data = mkdtempSync(join(tmpdir(), "ba-offline-http-"));
    const srv = createServer({ data, port: 0, host: "127.0.0.1", web: null, quiet: true });
    try {
      const base = `http://127.0.0.1:${srv.server.port}`;
      const setup = await (await fetch(`${base}/api/auth/setup`, { method: "POST", body: JSON.stringify({ username: "me", password: "longpassword", device: "phone" }) })).json();
      const auth = { authorization: `Bearer ${setup.token}` };
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: "POST", headers: { ...auth, ...headers }, body: JSON.stringify(body) });
      const nts = await (await fetch(`${base}/api/notetypes`, { headers: auth })).json();
      const basicId = nts.find((n: { name: string }) => n.name === "Basic").id;
      await post("/api/notes", { notetypeId: basicId, deckId: 1, fields: ["hola", "hello"] });

      const res = await post("/api/offline/pack", { deckIds: [1] }, { "accept-encoding": "gzip" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-encoding")).toBe("gzip");
      const p = await res.json(); // fetch decompresses
      expect(p.cards).toHaveLength(1);
      expect(p.cards[0].question).toContain("hola");
      expect(p.cards[0].question).toContain("__BA_NIGHT_CARD__");
      expect(p.mediaBase).toContain("/media/");

      const sync = await (
        await post("/api/offline/sync", {
          syncId: "s1",
          base: p.base,
          packTime: p.serverTime - 60_000,
          deviceNow: Date.now(),
          events: [{ id: "e1", kind: "answer", cardId: p.cards[0].id, ease: 3, at: Date.now() - 30_000, timeMs: 3000 }],
          baseCards: p.cards,
        })
      ).json();
      expect(sync).toMatchObject({ status: "ok", reviews: 1, newBase: p.base + 1 });
      expect((await post("/api/offline/sync", { syncId: "" })).status).toBe(400);
      expect((await fetch(`${base}/api/offline/pack`, { method: "POST", body: "{}" })).status).toBe(401);
    } finally {
      srv.stop();
      rmSync(data, { recursive: true, force: true });
    }
  });
});
