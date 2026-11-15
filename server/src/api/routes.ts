import type { Collection } from "../collection";
import { Router, num, type Ctx } from "./router";
import type { CardRow, DeckConfig, FilteredConfig, Notetype } from "../types";
import { CardType, Queue } from "../types";
import { assert, HttpError, nowSecs, splitFields, stripHtml, parseTags, dayNumber, sha1Hex, intervalLabel, escapeHtml, joinFields } from "../util";
import { renderCard, compareTypedAnswer, cardOrdsForNote } from "../render/template";
import { buildCardPage } from "../render/page";
import { buttonLabels, type Rating } from "../sched/scheduler";
import { nextCard, answerCard, undo, undoStatus, unburyIfNewDay, unburyDeck, buriedCount, studiedToday, pushUndo, snapshotCards, countsFor } from "../sched/queue";
import { deckTree, rebuildFiltered, createFiltered, customStudy, cardAction, deckOverview, type CardAction, type CustomStudy } from "../ops";
import { searchRows, type SearchRow } from "../search";
import { collectionStats, homeSummary, cardStateTrend } from "../stats";
import { importApkg } from "../importer/apkg";
import { previewCsv, importCsv, exportNotesText, type CsvImportOptions } from "../importer/text";
import { exportApkg } from "../exporter/apkg";
import { checkDatabase, findEmptyCards, checkMedia, deleteMediaFiles, backup, listBackups } from "../maintenance";
import { trainingSequences, recomputeMemory } from "../sched/memory";
import { evaluate, type OptimizeResult } from "../sched/optimizer";
import { FSRS, FSRS6_DEFAULT_PARAMS } from "../sched/fsrs";
import { STOCK_NOTETYPES } from "../stock";
import { layoutOptions, assignLayout, createLayout, changeNotetype, duplicateNotes, layoutNames, layoutFamilies } from "../layouts";
import { buildPack, syncOffline, type SyncRequest } from "../offline";
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";

export const VERSION = "0.2.0-beta.2";

export interface ServerOptions {
  /** Issues short-lived, HMAC-signed media URL tokens bound to a session. */
  mediaToken(sessionId: string): string;
}

function mediaBaseFor(ctx: Ctx, opts: ServerOptions): string {
  const host = ctx.req.headers.get("x-forwarded-host") ?? ctx.req.headers.get("host") ?? "localhost";
  const proto = ctx.req.headers.get("x-forwarded-proto") ?? ctx.url.protocol.replace(":", "");
  return `${proto}://${host}/media/${opts.mediaToken(ctx.session)}/`;
}

function deckName(col: Collection, c: CardRow) {
  return col.deck(c.did)?.name ?? "?";
}

export function buildRoutes(col: Collection, opts: ServerOptions): Router {
  const r = new Router();
  const csvUploads = new Map<string, { text: string; created: number }>();

  const renderFor = (c: CardRow, ctx: Ctx, extra: { night?: boolean; platform?: string; typed?: string | null; nightTokens?: boolean } = {}) => {
    const note = col.note(c.nid)!;
    const nt = col.notetype(note.ntid)!;
    const conf = col.configForCard(c);
    const rendered = renderCard(nt, splitFields(note.flds), c.ord, { tags: note.tags, deck: col.deck(c.odid || c.did)?.name ?? "", flag: c.flags & 7, cardId: c.id });
    const night = extra.night ?? ctx.query.get("night") === "1";
    const platform = extra.platform ?? ctx.query.get("platform") ?? "web";
    const base = mediaBaseFor(ctx, opts);
    let answerHtml = rendered.answer;
    if (rendered.typeAnswer) {
      const typed = extra.typed ?? null;
      answerHtml = answerHtml.replace("[[type:compare]]", typed === null ? `<code id="typeans">${escapeHtml(rendered.typeAnswer.expected)}</code>` : compareTypedAnswer(rendered.typeAnswer.expected, typed));
    }
    const autoplay = !conf.disableAutoplay;
    return {
      question: buildCardPage({ html: rendered.question, css: rendered.css, ord: c.ord, night, mediaBase: base, autoplay, side: "question", platform, nightTokens: extra.nightTokens }),
      answer: buildCardPage({ html: answerHtml, css: rendered.css, ord: c.ord, night, mediaBase: base, autoplay, side: "answer", platform, questionHtml: rendered.question, nightTokens: extra.nightTokens }),
      hasTypeAnswer: !!rendered.typeAnswer,
      questionText: stripHtml(rendered.question.replace(/<style[\s\S]*?<\/style>/gi, "")).slice(0, 300),
      answerText: stripHtml(answerHtml.replace(/<style[\s\S]*?<\/style>/gi, "")).slice(0, 300),
    };
  };

  const cardSummary = (c: CardRow) => {
    const note = col.note(c.nid)!;
    return {
      id: c.id,
      nid: c.nid,
      did: c.did,
      odid: c.odid,
      ord: c.ord,
      type: c.type,
      queue: c.queue,
      due: c.due,
      ivl: c.ivl,
      factor: c.factor,
      reps: c.reps,
      lapses: c.lapses,
      flags: c.flags & 7,
      stability: c.stability,
      difficulty: c.difficulty,
      marked: parseTags(note.tags).some((t) => t.toLowerCase() === "marked"),
      tags: parseTags(note.tags),
      ntid: note.ntid,
      deckName: deckName(col, c),
    };
  };

  const studyState = (deckId: number, ctx: Ctx, forceCardId?: number) => {
    unburyIfNewDay(col);
    const deck = col.deck(deckId);
    assert(deck, "Deck not found", 404);
    if (col.config.currentDeckId !== deckId) col.setConfig({ currentDeckId: deckId });
    const { next, counts, nextLearnDue } = nextCard(col, deckId);
    let card = next?.card ?? null;
    let queue = next?.queue ?? null;
    if (forceCardId) {
      const fc = col.card(forceCardId);
      if (fc && fc.queue >= 0) {
        card = fc;
        queue = fc.type === CardType.New ? "new" : fc.queue === Queue.Review ? "review" : "learn";
      }
    }
    const conf = card ? col.configForCard(card) : col.deckConfig(deck.kind === 0 ? deck.configId : 1);
    return {
      deck: { id: deck.id, name: deck.name, kind: deck.kind },
      counts,
      nextLearnDue,
      buried: buriedCount(col, deckId),
      undo: undoStatus(),
      today: studiedToday(col),
      timeboxMins: col.config.timeboxMins,
      card: card
        ? {
            ...cardSummary(card),
            queueName: queue,
            ...renderFor(card, ctx),
            buttons: buttonLabels(col, card),
            options: {
              showTimer: conf.showTimer,
              capAnswerSecs: conf.capAnswerSecs,
              autoplay: !conf.disableAutoplay,
              skipQuestionWhenReplayingAnswer: conf.skipQuestionWhenReplayingAnswer,
              autoAdvanceQuestionSecs: conf.autoAdvanceQuestionSecs,
              autoAdvanceAnswerSecs: conf.autoAdvanceAnswerSecs,
              autoAdvanceAnswerAction: conf.autoAdvanceAnswerAction,
            },
          }
        : null,
    };
  };

  // ---------------- meta ----------------
  r.get("/api/media-base", (ctx) => ({ base: mediaBaseFor(ctx, opts) }));
  r.get("/api/info", () => ({ version: VERSION, counts: col.counts(), today: col.today(), config: col.config }));
  r.get("/api/config", () => col.config);
  r.put("/api/config", async (ctx) => {
    const body = await ctx.json();
    const allowed = ["rolloverHour", "learnAheadMins", "timeboxMins", "fsrs", "loadBalancer", "currentDeckId", "addingDefaultsToCurrentDeck", "lastNotetypeId", "lastDeckId", "showIntervalsOnButtons", "showRemainingCount", "backupKeep", "newSpread", "dayLearnFirst"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    const turningOnFsrs = body.fsrs === true && !col.config.fsrs;
    col.setConfig(patch);
    if (turningOnFsrs) recomputeMemory(col, null, false);
    return col.config;
  });

  // ---------------- decks ----------------
  r.get("/api/decks", () => ({ tree: deckTree(col), today: studiedToday(col), currentDeckId: col.config.currentDeckId }));
  r.get("/api/decks/list", () => col.decks().map((d) => ({ id: d.id, name: d.name, kind: d.kind, configId: d.configId })));
  r.post("/api/decks", async (ctx) => {
    const { name } = await ctx.json<{ name: string }>();
    return col.ensureDeck(name);
  });
  r.get("/api/decks/:id", (ctx) => {
    const id = num(ctx.params.id);
    return { ...deckOverview(col, id), buried: buriedCount(col, id), today: studiedToday(col), trend: cardStateTrend(col, col.deckAndChildren(id)) };
  });
  r.patch("/api/decks/:id", async (ctx) => {
    const body = await ctx.json();
    const id = num(ctx.params.id);
    return col.updateDeck(id, body);
  });
  r.delete("/api/decks/:id", (ctx) => {
    const id = num(ctx.params.id);
    const ids = col.deckAndChildren(id);
    const cards = col.db.query<{ n: number }, []>(`SELECT count(*) n FROM cards WHERE did IN (${ids.join(",")})`).get()!.n;
    col.removeDeck(id);
    return { removedCards: cards };
  });
  r.post("/api/decks/:id/unbury", (ctx) => {
    unburyDeck(col, num(ctx.params.id));
    return { ok: true };
  });
  r.post("/api/decks/filtered", async (ctx) => {
    const body = await ctx.json<{ name: string } & Partial<FilteredConfig>>();
    assert(body.name?.trim(), "Name required");
    const d = createFiltered(col, body.name, body);
    return { deck: d, count: col.db.query<{ n: number }, [number]>("SELECT count(*) n FROM cards WHERE did=?").get(d.id)!.n };
  });
  r.post("/api/decks/:id/rebuild", (ctx) => ({ count: rebuildFiltered(col, num(ctx.params.id)) }));
  r.post("/api/decks/:id/empty", (ctx) => {
    col.emptyFiltered(num(ctx.params.id));
    return { ok: true };
  });
  r.post("/api/decks/:id/custom-study", async (ctx) => {
    const body = await ctx.json<CustomStudy>();
    return customStudy(col, { ...body, deckId: num(ctx.params.id) } as CustomStudy);
  });

  // ---------------- deck configs ----------------
  r.get("/api/deck-configs", () => col.allDeckConfigs());
  r.get("/api/deck-configs/:id", (ctx) => col.deckConfig(num(ctx.params.id)));
  r.post("/api/deck-configs", async (ctx) => {
    const { name, cloneFrom } = await ctx.json<{ name: string; cloneFrom?: number }>();
    assert(name?.trim(), "Name required");
    return col.addDeckConfig(name.trim(), cloneFrom);
  });
  r.put("/api/deck-configs/:id", async (ctx) => {
    const body = await ctx.json<DeckConfig & { reschedule?: boolean }>();
    const id = num(ctx.params.id);
    const old = col.deckConfig(id);
    const cleaned = sanitizeDeckConfig({ ...old, ...body, id });
    const saved = col.saveDeckConfig(cleaned);
    const paramsChanged = JSON.stringify(old.fsrsParams) !== JSON.stringify(saved.fsrsParams);
    if (col.config.fsrs && (paramsChanged || body.reschedule)) recomputeMemory(col, id, !!body.reschedule);
    return saved;
  });
  r.delete("/api/deck-configs/:id", (ctx) => {
    col.removeDeckConfig(num(ctx.params.id));
    return { ok: true };
  });
  r.post("/api/deck-configs/:id/optimize", async (ctx) => {
    const id = num(ctx.params.id);
    const conf = col.deckConfig(id);
    const seqs = trainingSequences(col, id);
    const result = await runOptimizer(seqs, conf.fsrsParams);
    return result;
  });
  r.post("/api/deck-configs/:id/evaluate", async (ctx) => {
    const id = num(ctx.params.id);
    const body = await ctx.json<{ params?: number[] }>().catch(() => ({}) as { params?: number[] });
    const seqs = trainingSequences(col, id);
    return evaluate(body.params ?? col.deckConfig(id).fsrsParams, seqs);
  });
  r.post("/api/fsrs/recompute", async (ctx) => {
    const { configId, reschedule } = await ctx.json<{ configId?: number | null; reschedule?: boolean }>();
    return recomputeMemory(col, configId ?? null, !!reschedule);
  });
  r.get("/api/fsrs/defaults", () => ({ params: FSRS6_DEFAULT_PARAMS }));
  r.post("/api/fsrs/simulate", async (ctx) => {
    // workload estimate for a desired retention: expected reviews/day over the next year (simple model)
    const { configId, retentions } = await ctx.json<{ configId: number; retentions?: number[] }>();
    const conf = col.deckConfig(configId);
    const fsrs = new FSRS(conf.fsrsParams);
    const rs = retentions ?? [0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97];
    return rs.map((dr) => {
      // average interval growth for a "typical" card over a year
      let s = fsrs.initStability(3);
      let d = fsrs.initDifficulty(3);
      let t = 0,
        reviews = 1;
      while (t < 365 && reviews < 200) {
        const ivl = fsrs.nextInterval(s, dr);
        t += ivl;
        reviews++;
        const r = fsrs.retrievability(ivl, s);
        // expected stability: mix of success/failure
        const sSucc = fsrs.nextRecallStability(d, s, r, 3);
        const sFail = fsrs.nextForgetStability(d, s, r);
        s = r * sSucc + (1 - r) * sFail;
        d = r * fsrs.nextDifficulty(d, 3) + (1 - r) * fsrs.nextDifficulty(d, 1);
      }
      return { retention: dr, reviewsPerCardPerYear: reviews, relativeWorkload: 0 };
    });
  });

  // ---------------- notetypes ----------------
  r.get("/api/notetypes", () => {
    const counts = col.noteCountByNotetype();
    return col.notetypes().map((n) => ({ ...n, noteCount: counts.get(n.id) ?? 0 }));
  });
  r.get("/api/notetypes/stock", () => Object.entries(STOCK_NOTETYPES).map(([key, v]) => ({ key, name: v.name })));
  r.get("/api/notetypes/:id", (ctx) => {
    const nt = col.notetype(num(ctx.params.id));
    assert(nt, "Notetype not found", 404);
    return { ...nt, noteCount: col.noteCountByNotetype().get(nt.id) ?? 0 };
  });
  r.post("/api/notetypes", async (ctx) => {
    const { stock, cloneFrom, name } = await ctx.json<{ stock?: string; cloneFrom?: number; name?: string }>();
    if (cloneFrom) return col.cloneNotetype(cloneFrom, name || `${col.notetype(cloneFrom)?.name} copy`);
    return col.addStockNotetype(stock ?? "basic", name);
  });
  r.put("/api/notetypes/:id", async (ctx) => col.updateNotetype(num(ctx.params.id), await ctx.json()));
  r.delete("/api/notetypes/:id", (ctx) => {
    col.removeNotetype(num(ctx.params.id));
    return { ok: true };
  });

  // ---------------- notes ----------------
  r.post("/api/notes", async (ctx) => {
    const b = await ctx.json<{ notetypeId: number; deckId: number; fields: string[]; tags?: string[] }>();
    const res = col.addNote(b.notetypeId, b.fields, b.tags ?? [], b.deckId);
    col.setConfig({ lastNotetypeId: b.notetypeId, lastDeckId: b.deckId });
    pushUndo({ label: "Add Note", cards: [], deleteCards: col.cardsOfNote(res.id).map((c) => c.id) });
    return res;
  });
  r.post("/api/notes/check", async (ctx) => {
    // duplicate check + card generation preview while typing
    const b = await ctx.json<{ notetypeId: number; fields: string[]; noteId?: number }>();
    const nt = col.notetype(b.notetypeId);
    assert(nt, "Notetype not found", 404);
    const first = b.fields[0] ?? "";
    const stripped = stripHtml(first);
    let duplicate = false;
    if (stripped) {
      const { fieldChecksum } = await import("../util");
      const rows = col.db.query<{ id: number; flds: string }, [number, number]>("SELECT id, flds FROM notes WHERE ntid=? AND csum=?").all(nt.id, fieldChecksum(first));
      duplicate = rows.some((r) => r.id !== b.noteId && stripHtml(splitFields(r.flds)[0] ?? "") === stripped);
    }
    const ords = cardOrdsForNote(nt, b.fields);
    return { duplicate, cards: ords.length, empty: ords.length === 0 };
  });
  r.get("/api/notes/:id", (ctx) => {
    const note = col.note(num(ctx.params.id));
    assert(note, "Note not found", 404);
    const nt = col.notetype(note.ntid)!;
    return {
      id: note.id,
      guid: note.guid,
      notetypeId: nt.id,
      notetype: nt,
      fields: splitFields(note.flds),
      tags: parseTags(note.tags),
      mtime: note.mtime,
      cards: col.cardsOfNote(note.id).map((c) => ({ id: c.id, ord: c.ord, did: c.odid || c.did, deck: col.deck(c.odid || c.did)?.name, template: nt.kind === 1 ? `Cloze ${c.ord + 1}` : nt.templates[c.ord]?.name, queue: c.queue, type: c.type })),
    };
  });
  r.put("/api/notes/:id", async (ctx) => {
    const b = await ctx.json<{ fields?: string[]; tags?: string[] }>();
    const id = num(ctx.params.id);
    const before = col.note(id);
    assert(before, "Note not found", 404);
    const existingCards = new Set(col.cardsOfNote(id).map((c) => c.id));
    col.updateNote(id, b.fields, b.tags);
    const created = col.cardsOfNote(id).filter((c) => !existingCards.has(c.id)).map((c) => c.id);
    pushUndo({ label: "Edit Note", cards: [], deleteCards: created, notes: [{ id, tags: before.tags, mtime: before.mtime, flds: before.flds }] });
    return { ok: true, newCards: created.length };
  });
  r.post("/api/notes/delete", async (ctx) => {
    const { noteIds } = await ctx.json<{ noteIds: number[] }>();
    col.removeNotes(noteIds);
    return { removed: noteIds.length };
  });
  r.post("/api/notes/tags", async (ctx) => {
    const b = await ctx.json<{ noteIds: number[]; add?: string[]; remove?: string[] }>();
    const before = b.noteIds.map((id) => col.note(id)).filter(Boolean).map((n) => ({ id: n!.id, tags: n!.tags, mtime: n!.mtime }));
    col.modifyTags(b.noteIds, b.add ?? [], b.remove ?? []);
    pushUndo({ label: b.add?.length ? "Add Tags" : "Remove Tags", cards: [], notes: before });
    return { ok: true };
  });
  r.post("/api/notes/find-replace", async (ctx) => {
    const b = await ctx.json<{ noteIds: number[]; find: string; replace: string; regex?: boolean; matchCase?: boolean; field?: string | null }>();
    assert(b.find, "Nothing to find");
    const re = new RegExp(b.regex ? b.find : b.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), b.matchCase ? "g" : "gi");
    let changed = 0;
    col.tx(() => {
      for (const id of b.noteIds) {
        const n = col.note(id);
        if (!n) continue;
        const nt = col.notetype(n.ntid)!;
        if (b.field === "__tags__") {
          const nt2 = n.tags.replace(re, b.replace);
          if (nt2 !== n.tags) {
            col.updateNote(id, undefined, parseTags(nt2));
            changed++;
          }
          continue;
        }
        const f = splitFields(n.flds);
        let any = false;
        const out = f.map((v, i) => {
          if (b.field && nt.fields[i]?.name !== b.field) return v;
          const nv = v.replace(re, b.replace);
          if (nv !== v) any = true;
          return nv;
        });
        if (any) {
          col.updateNote(id, out);
          changed++;
        }
      }
    });
    return { changed };
  });
  r.post("/api/notes/change-notetype", async (ctx) => {
    const b = await ctx.json<{ noteIds: number[]; notetypeId: number; fieldMap: number[]; templateMap?: number[] }>();
    return { changed: changeNotetype(col, b.noteIds, b.notetypeId, b.fieldMap, b.templateMap) };
  });
  r.post("/api/notes/duplicate", async (ctx) => duplicateNotes(col, await ctx.json<{ cardIds?: number[]; noteIds?: number[] }>()));

  // ---------------- offline study (docs/OFFLINE.md) ----------------
  r.post("/api/offline/pack", async (ctx) => {
    const b = await ctx.json<{ deckIds: number[]; days?: number; platform?: string }>();
    const platform = b.platform ?? "android";
    const pack = buildPack(col, b, (c) => {
      const p = renderFor(c, ctx, { platform, nightTokens: true });
      return { question: p.question, answer: p.answer, hasTypeAnswer: p.hasTypeAnswer, questionText: p.questionText };
    }, mediaBaseFor(ctx, opts));
    const body = JSON.stringify(pack);
    if (!/\bgzip\b/.test(ctx.req.headers.get("accept-encoding") ?? "")) return new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } });
    return new Response(Bun.gzipSync(body), { headers: { "content-type": "application/json; charset=utf-8", "content-encoding": "gzip" } });
  });
  r.post("/api/offline/sync", async (ctx) => syncOffline(col, await ctx.json<SyncRequest>()));

  // ---------------- display order (layouts) ----------------
  r.get("/api/layouts", () => layoutFamilies(col));
  r.post("/api/layouts/options", async (ctx) => layoutOptions(col, (await ctx.json<{ cardIds: number[] }>()).cardIds ?? []));
  r.post("/api/layouts/assign", async (ctx) => {
    const b = await ctx.json<{ cardIds: number[]; notetypeId: number }>();
    return assignLayout(col, b.cardIds ?? [], Number(b.notetypeId));
  });
  r.post("/api/layouts", async (ctx) => createLayout(col, await ctx.json<{ cardIds: number[]; name: string; qfmt: string; afmt: string }>()));

  // ---------------- cards ----------------
  r.get("/api/cards/:id", (ctx) => {
    const c = col.card(num(ctx.params.id));
    assert(c, "Card not found", 404);
    return { ...cardSummary(c), ...renderFor(c, ctx) };
  });
  r.get("/api/cards/:id/info", (ctx) => cardInfo(col, num(ctx.params.id)));
  r.post("/api/cards/actions", async (ctx) => cardAction(col, await ctx.json<CardAction>()));
  r.post("/api/render/preview", async (ctx) => {
    // Render arbitrary content (card template editor / add-note preview)
    const b = await ctx.json<{ notetype?: Notetype; notetypeId?: number; fields: string[]; ord: number; tags?: string; night?: boolean; platform?: string }>();
    const nt = b.notetype ?? col.notetype(b.notetypeId ?? 0);
    assert(nt, "Notetype not found", 404);
    const fields = b.fields.length ? b.fields : nt.fields.map((f) => `(${f.name})`);
    const rendered = renderCard(nt, fields, b.ord ?? 0, { tags: b.tags ?? "", deck: "Preview", flag: 0, cardId: 0 });
    const base = mediaBaseFor(ctx, opts);
    const answer = rendered.answer.replace("[[type:compare]]", rendered.typeAnswer ? `<code id="typeans">${escapeHtml(rendered.typeAnswer.expected)}</code>` : "");
    return {
      question: buildCardPage({ html: rendered.question, css: rendered.css, ord: b.ord ?? 0, night: !!b.night, mediaBase: base, autoplay: false, side: "question", platform: b.platform }),
      answer: buildCardPage({ html: answer, css: rendered.css, ord: b.ord ?? 0, night: !!b.night, mediaBase: base, autoplay: false, side: "answer", platform: b.platform, questionHtml: rendered.question }),
      ords: cardOrdsForNote(nt, fields),
    };
  });

  // ---------------- browse ----------------
  r.get("/api/browse", (ctx) => browse(col, ctx));
  r.get("/api/tags", () => col.allTags());
  r.post("/api/tags/rename", async (ctx) => {
    const { from, to } = await ctx.json<{ from: string; to: string }>();
    assert(to.trim() && !/\s/.test(to.trim()), "Tags can't contain spaces");
    return { notes: col.renameTag(from, to.trim()) };
  });
  r.post("/api/tags/remove", async (ctx) => ({ notes: col.removeTagEverywhere((await ctx.json<{ tag: string }>()).tag) }));
  r.post("/api/tags/clear-unused", () => ({ removed: col.clearUnusedTags() }));

  // ---------------- study ----------------
  r.get("/api/study/:deckId", (ctx) => studyState(num(ctx.params.deckId), ctx));
  r.post("/api/study/:deckId/answer", async (ctx) => {
    const b = await ctx.json<{ cardId: number; ease: Rating; timeMs: number }>();
    assert([1, 2, 3, 4].includes(b.ease), "Invalid ease");
    const res = answerCard(col, b.cardId, b.ease, b.timeMs ?? 0);
    return { ...studyState(num(ctx.params.deckId), ctx), answered: { cardId: b.cardId, leech: res.leech, suspended: res.card.queue === Queue.Suspended } };
  });
  r.post("/api/study/:deckId/undo", (ctx) => {
    const u = undo(col);
    return { ...studyState(num(ctx.params.deckId), ctx, u?.cardId), undone: u?.label ?? null };
  });
  r.post("/api/study/:deckId/action", async (ctx) => {
    const b = await ctx.json<{ cardId: number; action: "bury" | "buryNote" | "suspend" | "suspendNote" | "flag" | "mark" | "forget" | "delete" | "setDue"; flag?: number; days?: string }>();
    const c = col.card(b.cardId);
    assert(c, "Card not found", 404);
    const siblings = col.cardsOfNote(c.nid).map((x) => x.id);
    switch (b.action) {
      case "bury":
        cardAction(col, { action: "bury", cardIds: [c.id] });
        break;
      case "buryNote":
        cardAction(col, { action: "bury", cardIds: siblings });
        break;
      case "suspend":
        cardAction(col, { action: "suspend", cardIds: [c.id] });
        break;
      case "suspendNote":
        cardAction(col, { action: "suspend", cardIds: siblings });
        break;
      case "flag":
        cardAction(col, { action: "flag", cardIds: [c.id], flag: (c.flags & 7) === b.flag ? 0 : (b.flag ?? 0) });
        return { ...studyState(num(ctx.params.deckId), ctx, c.id) };
      case "mark": {
        const n = col.note(c.nid)!;
        const marked = parseTags(n.tags).some((t) => t.toLowerCase() === "marked");
        pushUndo({ label: marked ? "Unmark" : "Mark", cards: [], notes: [{ id: n.id, tags: n.tags, mtime: n.mtime }] });
        col.modifyTags([n.id], marked ? [] : ["marked"], marked ? ["marked"] : []);
        return { ...studyState(num(ctx.params.deckId), ctx, c.id) };
      }
      case "forget":
        cardAction(col, { action: "forget", cardIds: [c.id] });
        break;
      case "setDue":
        cardAction(col, { action: "setDue", cardIds: [c.id], days: b.days ?? "1" });
        break;
      case "delete": {
        col.removeNotes([c.nid]);
        break;
      }
    }
    return studyState(num(ctx.params.deckId), ctx);
  });
  r.post("/api/study/answer-page", async (ctx) => {
    const b = await ctx.json<{ cardId: number; typed: string; night?: boolean; platform?: string }>();
    const c = col.card(b.cardId);
    assert(c, "Card not found", 404);
    return { answer: renderFor(c, ctx, { night: b.night, platform: b.platform, typed: b.typed ?? "" }).answer };
  });
  r.get("/api/undo", () => undoStatus());
  r.post("/api/undo", () => ({ undone: undo(col)?.label ?? null }));

  // ---------------- stats ----------------
  r.get("/api/stats", (ctx) => {
    const deck = ctx.query.get("deck");
    return collectionStats(col, deck ? num(deck) : null, Math.min(3650, Math.max(7, num(ctx.query.get("days"), 30))));
  });
  r.get("/api/stats/today", () => studiedToday(col));
  r.get("/api/home", () => homeSummary(col));

  // ---------------- import / export ----------------
  r.post("/api/import", async (ctx) => {
    const form = await ctx.req.formData();
    const file = form.get("file");
    assert(file && typeof file !== "string", "No file uploaded");
    const options = JSON.parse(String(form.get("options") ?? "{}"));
    const name = (file as File).name.toLowerCase();
    const bytes = new Uint8Array(await (file as File).arrayBuffer());
    if (name.endsWith(".apkg") || name.endsWith(".colpkg") || name.endsWith(".zip")) {
      try {
        backup(col);
      } catch {}
      return { kind: "package", result: importApkg(col, bytes, options) };
    }
    const text = new TextDecoder().decode(bytes);
    const token = sha1Hex(text).slice(0, 16);
    csvUploads.set(token, { text, created: Date.now() });
    for (const [k, v] of csvUploads) if (Date.now() - v.created > 3600_000) csvUploads.delete(k);
    return { kind: "text", token, preview: previewCsv(text) };
  });
  r.post("/api/import/csv/preview", async (ctx) => {
    const b = await ctx.json<{ token: string; delimiter?: string }>();
    const up = csvUploads.get(b.token);
    assert(up, "Upload expired, please choose the file again", 410);
    return previewCsv(up.text, b.delimiter);
  });
  r.post("/api/import/csv", async (ctx) => {
    const b = await ctx.json<{ token: string } & CsvImportOptions>();
    const up = csvUploads.get(b.token);
    assert(up, "Upload expired, please choose the file again", 410);
    const res = importCsv(col, up.text, b);
    csvUploads.delete(b.token);
    return res;
  });
  r.get("/api/export/apkg", (ctx) => {
    const deck = ctx.query.get("deck");
    const deckId = deck ? num(deck) : null;
    const noteIds = ctx.query.get("notes")?.split(",").map(Number).filter(Boolean);
    const data = exportApkg(col, {
      deckId,
      noteIds,
      includeScheduling: ctx.query.get("scheduling") === "1",
      includeMedia: ctx.query.get("media") !== "0",
    });
    const fname = (deckId ? col.deck(deckId)?.name.replace(/::/g, "__") : "collection") ?? "export";
    return new Response(data, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${encodeURIComponent(fname)}.apkg"` } });
  });
  r.get("/api/export/notes", (ctx) => {
    const deck = ctx.query.get("deck");
    const q = ctx.query.get("q") ?? (deck ? `deck:"${col.deck(num(deck))?.name}"` : "");
    const nids = [...new Set(searchRows(col, q).map((r) => r.nid))];
    const text = exportNotesText(col, nids, { html: ctx.query.get("html") === "1", tags: ctx.query.get("tags") !== "0", deckNotetype: ctx.query.get("meta") === "1" });
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="notes.txt"` } });
  });
  r.get("/api/backups", () => listBackups(col));
  r.post("/api/backups", () => ({ path: backup(col) }));

  // ---------------- maintenance ----------------
  r.post("/api/check-database", () => checkDatabase(col));
  r.get("/api/empty-cards", () => findEmptyCards(col));
  r.post("/api/empty-cards", async (ctx) => {
    const { cardIds } = await ctx.json<{ cardIds: number[] }>();
    col.removeCards(cardIds, false);
    return { removed: cardIds.length };
  });
  r.get("/api/check-media", () => checkMedia(col));
  r.post("/api/media/delete", async (ctx) => ({ removed: deleteMediaFiles(col, (await ctx.json<{ files: string[] }>()).files) }));

  // ---------------- media upload ----------------
  r.post("/api/media", async (ctx) => {
    const type = ctx.req.headers.get("content-type") ?? "";
    let name: string;
    let bytes: Uint8Array;
    if (type.includes("multipart/form-data")) {
      const form = await ctx.req.formData();
      const f = form.get("file") as File | null;
      assert(f && typeof f !== "string", "No file");
      name = f.name || "pasted.png";
      bytes = new Uint8Array(await f.arrayBuffer());
    } else {
      const b = await ctx.json<{ name: string; data: string }>();
      name = b.name;
      bytes = Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0));
    }
    return { filename: storeMedia(col, name, bytes) };
  });

  return r;
}

export function storeMedia(col: Collection, name: string, bytes: Uint8Array): string {
  const sha = sha1Hex(bytes);
  const dup = col.db.query<{ fname: string }, [string]>("SELECT fname FROM media WHERE sha1=?").get(sha);
  if (dup && col.media.has(dup.fname)) return dup.fname;
  let safe = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "") || "file";
  if (safe.length > 120) safe = safe.slice(0, 100) + extname(safe);
  let target = safe;
  if (col.db.query("SELECT 1 FROM media WHERE fname=?").get(target) || col.media.has(target)) {
    const ext = extname(safe);
    target = `${safe.slice(0, safe.length - ext.length)}-${sha.slice(0, 8)}${ext}`;
  }
  col.media.write(target, bytes);
  col.db.query("INSERT OR REPLACE INTO media(fname,sha1,size,mtime) VALUES (?,?,?,?)").run(target, sha, bytes.length, nowSecs());
  return target;
}

function sanitizeDeckConfig(c: DeckConfig): DeckConfig {
  const steps = (s: unknown) => (Array.isArray(s) ? s.map(Number).filter((x) => Number.isFinite(x) && x > 0) : []);
  return {
    ...c,
    name: String(c.name || "Preset").trim(),
    newPerDay: Math.max(0, Math.round(Number(c.newPerDay) || 0)),
    reviewsPerDay: Math.max(0, Math.round(Number(c.reviewsPerDay) || 0)),
    learnSteps: steps(c.learnSteps),
    relearnSteps: steps(c.relearnSteps),
    graduatingIvl: Math.max(1, Math.round(c.graduatingIvl)),
    easyIvl: Math.max(1, Math.round(c.easyIvl)),
    initialEase: Math.min(5, Math.max(1.31, Number(c.initialEase))),
    maxIvl: Math.max(1, Math.round(c.maxIvl)),
    minLapseIvl: Math.max(1, Math.round(c.minLapseIvl)),
    lapseMult: Math.min(1, Math.max(0, Number(c.lapseMult))),
    easyMult: Math.max(1, Number(c.easyMult)),
    hardMult: Math.max(0.5, Number(c.hardMult)),
    ivlMult: Math.max(0.1, Number(c.ivlMult)),
    desiredRetention: Math.min(0.99, Math.max(0.7, Number(c.desiredRetention))),
    leechThreshold: Math.max(0, Math.round(c.leechThreshold)),
    fsrsParams: Array.isArray(c.fsrsParams) && [17, 19, 21].includes(c.fsrsParams.length) ? c.fsrsParams.map(Number) : [...FSRS6_DEFAULT_PARAMS],
  };
}

function runOptimizer(seqs: ReturnType<typeof trainingSequences>, init: number[]): Promise<OptimizeResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../sched/optimizer-worker.ts", import.meta.url).href);
    const timer = setTimeout(() => {
      w.terminate();
      reject(new HttpError(504, "Optimization timed out"));
    }, 300_000);
    w.onmessage = (e: MessageEvent) => {
      if (e.data?.done) {
        clearTimeout(timer);
        w.terminate();
        resolve(e.data.result);
      }
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      reject(new HttpError(500, `Optimizer failed: ${e.message}`));
    };
    w.postMessage({ seqs, init });
  });
}

// ---------------- browse ----------------
function dueString(col: Collection, c: SearchRow, today: number): { text: string; sort: number } {
  if (c.odid && c.type === 0) return { text: "(filtered)", sort: 2e12 };
  const due = c.odid && c.odue ? c.odue : c.due;
  let text = "";
  let sort = 0;
  if (c.type === CardType.New) {
    text = `New #${due}`;
    sort = 1e12 + due;
  } else if (c.queue === Queue.Learn || c.queue === Queue.Preview || (c.queue < 0 && due > 1e9)) {
    text = new Date(due * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    sort = due;
  } else {
    const ts = (due - today) * 86400 + nowSecs();
    text = new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    sort = ts;
  }
  if (c.queue === Queue.Suspended) text = `(${text})`;
  else if (c.queue === Queue.SchedBuried || c.queue === Queue.UserBuried) text = `[${text}]`;
  return { text, sort };
}

/** Browser card states, in their sort order. */
export const CARD_STATES = ["new", "learning", "review", "due", "suspended", "buried", "marked", "leech"] as const;
export type CardState = (typeof CARD_STATES)[number];
/** One state per card. Tags win (leech, then marked), then suspended/buried, then the scheduling state. */
export function cardState(r: SearchRow, today: number): CardState {
  const tags = parseTags(r.tags).map((t) => t.toLowerCase());
  if (tags.includes("leech")) return "leech";
  if (tags.includes("marked")) return "marked";
  if (r.queue === Queue.Suspended) return "suspended";
  if (r.queue === Queue.SchedBuried || r.queue === Queue.UserBuried) return "buried";
  if (r.type === CardType.New) return "new";
  if (r.type === CardType.Learn || r.type === CardType.Relearn) return "learning";
  return (r.odid ? r.odue || r.due : r.due) <= today ? "due" : "review";
}

function browse(col: Collection, ctx: Ctx) {
  const q = ctx.query.get("q") ?? "";
  const mode = ctx.query.get("mode") === "notes" ? "notes" : "cards";
  const sort = ctx.query.get("sort") ?? "created";
  const desc = ctx.query.get("desc") === "1";
  const offset = num(ctx.query.get("offset"), 0);
  const limit = Math.min(500, num(ctx.query.get("limit"), 100));
  const today = col.today();
  let rows = searchRows(col, q);
  if (mode === "notes") {
    const seen = new Map<number, SearchRow>();
    for (const r of rows) if (!seen.has(r.nid) || r.ord < seen.get(r.nid)!.ord) seen.set(r.nid, r);
    rows = [...seen.values()];
  }
  const ntName = (id: number) => col.notetype(id)?.name ?? "";
  const tmplName = (r: SearchRow) => {
    const nt = col.notetype(r.ntid);
    return nt?.kind === 1 ? `Cloze ${r.ord + 1}` : (nt?.templates[r.ord]?.name ?? "");
  };
  // "#": position in the order the home deck came with (by note creation, then card template), 1-based per deck
  const order = new Map<number, number>();
  for (const o of col.db
    .query<{ id: number; card: number; note: number }, []>(
      `SELECT id, ROW_NUMBER() OVER w card, DENSE_RANK() OVER (PARTITION BY CASE WHEN odid != 0 THEN odid ELSE did END ORDER BY nid) note
       FROM cards WINDOW w AS (PARTITION BY CASE WHEN odid != 0 THEN odid ELSE did END ORDER BY nid, ord)`,
    )
    .iterate())
    order.set(o.id, mode === "notes" ? o.note : o.card);
  const homeDeck = (r: SearchRow) => (col.deck(r.odid || r.did)?.name ?? "").toLowerCase();
  const layouts = layoutNames(col);
  const layoutOf = (r: SearchRow) => layouts.get(r.ntid);
  const key = (r: SearchRow): number | string => {
    switch (sort) {
      case "order": // grouped by home deck, so numbers from different decks don't interleave
        return `${homeDeck(r)}\u0000${String(order.get(r.id) ?? 0).padStart(9, "0")}`;
      case "sortField":
        return r.sfld.toLowerCase();
      case "due":
        return dueString(col, r, today).sort;
      case "ivl":
        return r.type === 2 ? r.ivl : -1;
      case "ease":
        return r.factor;
      case "reps":
        return r.reps;
      case "lapses":
        return r.lapses;
      case "modified":
        return mode === "notes" ? r.nmtime : r.mtime;
      case "deck":
        return (col.deck(r.did)?.name ?? "").toLowerCase();
      case "notetype":
        return ntName(r.ntid).toLowerCase();
      case "template":
        return tmplName(r).toLowerCase();
      case "state":
        return CARD_STATES.indexOf(cardState(r, today));
      case "layout": {
        // grouped by note type, Default first, then layouts by name
        const l = layoutOf(r);
        return `${(l?.base ?? "").toLowerCase()}\u0000${l && !l.isDefault ? l.name.toLowerCase() : ""}`;
      }
      case "difficulty":
        return r.difficulty ?? -1;
      case "stability":
        return r.stability ?? -1;
      default:
        return mode === "notes" ? r.nid : r.id;
    }
  };
  rows.sort((a, b) => {
    const ka = key(a),
      kb = key(b);
    const c = ka < kb ? -1 : ka > kb ? 1 : a.id - b.id;
    return desc ? -c : c;
  });
  const page = rows.slice(offset, offset + limit);
  const cardCounts = mode === "notes" ? new Map(col.db.query<{ nid: number; n: number }, []>("SELECT nid, count(*) n FROM cards GROUP BY nid").all().map((r) => [r.nid, r.n])) : null;
  const out = page.map((r) => {
    const nt = col.notetype(r.ntid)!;
    let question = "";
    let answer = "";
    try {
      const rc = renderCard(nt, splitFields(r.flds), r.ord, { tags: r.tags, deck: col.deck(r.odid || r.did)?.name ?? "", flag: r.flags, cardId: r.id }, { browser: true });
      const clean = (h: string) => stripHtml(h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/\[sound:[^\]]+\]/g, "🔊")).replace(/\s+/g, " ").trim();
      question = clean(rc.question).slice(0, 200);
      let a = rc.answer.replace("[[type:compare]]", "");
      if (a.startsWith(rc.question)) a = a.slice(rc.question.length);
      a = a.replace(/^[\s\S]*?<hr id=["']?answer["']?>/i, "");
      answer = clean(a).slice(0, 200);
    } catch {}
    const due = dueString(col, r, today);
    return {
      id: r.id,
      nid: r.nid,
      order: order.get(r.id) ?? 0,
      sortField: r.sfld.slice(0, 200),
      question,
      answer,
      deck: col.deck(r.did)?.name ?? "",
      notetype: nt.name,
      template: tmplName(r),
      due: due.text,
      ivl: r.type === 2 ? intervalLabel(r.ivl * 86400) : r.type === 0 ? "(new)" : "(learning)",
      ease: r.type === 0 ? "(new)" : r.factor ? `${Math.round(r.factor / 10)}%` : "",
      difficulty: r.difficulty != null ? `${Math.round(((r.difficulty - 1) / 9) * 100)}%` : "",
      stability: r.stability != null ? intervalLabel(r.stability * 86400) : "",
      reps: r.reps,
      lapses: r.lapses,
      created: new Date((mode === "notes" ? r.nid : r.id)).toISOString().slice(0, 10),
      modified: new Date((mode === "notes" ? r.nmtime : r.mtime) * 1000).toISOString().slice(0, 10),
      tags: parseTags(r.tags),
      flags: r.flags & 7,
      state: cardState(r, today),
      layout: layoutOf(r)?.name ?? "Default",
      queue: r.queue,
      type: r.type,
      marked: parseTags(r.tags).some((t) => t.toLowerCase() === "marked"),
      cards: cardCounts?.get(r.nid) ?? 1,
    };
  });
  return { total: rows.length, mode, rows: out, ids: rows.map((r) => (mode === "notes" ? r.nid : r.id)), cardIds: mode === "notes" ? undefined : undefined };
}

function cardInfo(col: Collection, id: number) {
  const c = col.card(id);
  assert(c, "Card not found", 404);
  const note = col.note(c.nid)!;
  const nt = col.notetype(note.ntid)!;
  const revs = col.db.query<{ id: number; ease: number; ivl: number; last_ivl: number; factor: number; time: number; type: number }, [number]>("SELECT * FROM revlog WHERE cid=? ORDER BY id DESC").all(id);
  const today = col.today();
  const conf = col.configForCard(c);
  const fsrs = new FSRS(conf.fsrsParams);
  const real = revs.filter((r) => r.ease > 0 && r.type !== 4);
  let retrievability: number | null = null;
  if (c.stability && c.last_review) retrievability = fsrs.retrievability(today - dayNumber(c.last_review, col.config.rolloverHour), c.stability);
  const due = c.odid && c.odue ? c.odue : c.due;
  return {
    id: c.id,
    noteId: c.nid,
    added: c.id,
    firstReview: real.length ? real[real.length - 1].id : null,
    latestReview: real.length ? real[0].id : null,
    due: c.type === 0 ? null : c.queue === Queue.Learn ? due * 1000 : (due - today) * 86400 * 1000 + Date.now(),
    position: c.type === 0 ? due : null,
    interval: c.type === 2 ? c.ivl : null,
    ease: c.factor ? c.factor / 10 : null,
    reviews: c.reps,
    lapses: c.lapses,
    averageTimeMs: real.length ? real.reduce((a, r) => a + r.time, 0) / real.length : null,
    totalTimeMs: real.reduce((a, r) => a + r.time, 0),
    cardType: nt.kind === 1 ? `Cloze ${c.ord + 1}` : nt.templates[c.ord]?.name,
    notetype: nt.name,
    deck: col.deck(c.odid || c.did)?.name,
    filteredDeck: c.odid ? col.deck(c.did)?.name : null,
    stability: c.stability,
    difficulty: c.difficulty != null ? (c.difficulty - 1) / 9 : null,
    retrievability,
    desiredRetention: conf.desiredRetention,
    state: ["New", "Learning", "Review", "Relearning"][c.type],
    queue: c.queue,
    flags: c.flags & 7,
    revlog: revs.map((r) => ({ id: r.id, ease: r.ease, ivl: r.ivl, lastIvl: r.last_ivl, factor: r.factor, time: r.time, type: r.type })),
  };
}

void countsFor;
void snapshotCards;
void readFileSync;
void unlinkSync;
void join;
void tmpdir;
