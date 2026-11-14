import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection } from "../src/collection";
import { FSRS, FSRS6_DEFAULT_PARAMS } from "../src/sched/fsrs";
import { computeOutcomes, buttonLabels, fuzzBounds } from "../src/sched/scheduler";
import { nextCard, answerCard, undo, countsFor } from "../src/sched/queue";
import { renderCard, cardOrdsForNote, compareTypedAnswer } from "../src/render/template";
import { renderCloze } from "../src/render/cloze";
import { buildCardPage } from "../src/render/page";
import { searchCardIds } from "../src/search";
import { importApkg } from "../src/importer/apkg";
import { exportApkg } from "../src/exporter/apkg";
import { importCsv, previewCsv } from "../src/importer/text";
import { createFiltered, customStudy, cardAction, deckTree } from "../src/ops";
import { checkDatabase, findEmptyCards } from "../src/maintenance";
import { homeSummary, TREND_DAYS } from "../src/stats";
import { optimize } from "../src/sched/optimizer";
import { splitFields } from "../src/util";
import { randomKey } from "../src/crypto/aead";

const KEY = randomKey();

let dir: string;
let col: Collection;
const fixture = (n: string) => new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", n)));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ba-test-"));
  col = new Collection(dir, KEY, { autoFlush: false });
});
afterEach(() => {
  col.close();
  rmSync(dir, { recursive: true, force: true });
});

const basic = () => col.notetypeByName("Basic")!;
const NOW = Math.floor(Date.now() / 1000);

describe("FSRS", () => {
  test("initial state and intervals", () => {
    const f = new FSRS();
    const s = f.nextState(null, 0, 3);
    expect(s.stability).toBeCloseTo(FSRS6_DEFAULT_PARAMS[2], 5);
    expect(s.difficulty).toBeGreaterThan(1);
    expect(f.retrievability(0, 10)).toBe(1);
    // interval at 90% retention ≈ stability
    expect(f.nextInterval(10, 0.9)).toBe(10);
    expect(f.nextInterval(10, 0.8)).toBeGreaterThan(10);
  });
  test("success grows stability, failure shrinks it", () => {
    const f = new FSRS();
    const m = { stability: 10, difficulty: 5 };
    expect(f.nextState(m, 10, 3).stability).toBeGreaterThan(10);
    expect(f.nextState(m, 10, 1).stability).toBeLessThan(10);
    expect(f.nextState(m, 10, 4).stability).toBeGreaterThan(f.nextState(m, 10, 3).stability);
    expect(f.nextState(m, 10, 1).difficulty).toBeGreaterThan(5);
  });
  test("fuzz bounds match Anki ranges", () => {
    expect(fuzzBounds(1, 1, 100)).toEqual([1, 1]);
    const [lo, hi] = fuzzBounds(30, 1, 36500);
    expect(lo).toBeLessThan(30);
    expect(hi).toBeGreaterThan(30);
  });
});

describe("scheduling (SM-2)", () => {
  beforeEach(() => col.setConfig({ fsrs: false, loadBalancer: false }));
  test("new card learning steps 1m 10m", () => {
    col.addNote(basic().id, ["q", "a"], [], 1);
    const card = col.db.query<any, []>("SELECT * FROM cards").get();
    const labels = buttonLabels(col, card, NOW).map((b) => b.label);
    expect(labels).toEqual(["1m", "6m", "10m", "4d"]);
  });
  test("graduation and review intervals", () => {
    col.addNote(basic().id, ["q", "a"], [], 1);
    let card = col.db.query<any, []>("SELECT * FROM cards").get();
    answerCard(col, card.id, 3, 1000, NOW); // -> step 2 (10m)
    card = col.card(card.id)!;
    expect(card.queue).toBe(1);
    answerCard(col, card.id, 3, 1000, NOW + 700); // graduate 1d
    card = col.card(card.id)!;
    expect(card.type).toBe(2);
    expect(card.ivl).toBe(1);
    expect(card.factor).toBe(2500);
    // review again after it's due: good ≈ ivl*2.5
    const o = computeOutcomes(col, { ...card, due: col.today() }, NOW + 86400);
    expect(o[3].card.ivl).toBeGreaterThanOrEqual(2);
    expect(o[4].card.ivl).toBeGreaterThan(o[3].card.ivl);
    expect(o[2].card.ivl).toBeLessThanOrEqual(o[3].card.ivl);
    // lapse -> relearning
    expect(o[1].card.type).toBe(3);
    expect(o[1].card.lapses).toBe(1);
    expect(o[1].card.factor).toBe(2300);
  });
});

describe("scheduling (FSRS)", () => {
  test("review intervals ordered and stored memory", () => {
    col.addNote(basic().id, ["q", "a"], [], 1);
    let card = col.db.query<any, []>("SELECT * FROM cards").get();
    answerCard(col, card.id, 4, 1000, NOW); // easy -> graduate
    card = col.card(card.id)!;
    expect(card.type).toBe(2);
    expect(card.stability).toBeGreaterThan(1);
    const o = computeOutcomes(col, { ...card, due: col.today() }, NOW + card.ivl * 86400);
    expect(o[2].card.ivl).toBeLessThan(o[3].card.ivl);
    expect(o[3].card.ivl).toBeLessThan(o[4].card.ivl);
  });
});

describe("study queue", () => {
  test("counts, limits, answer and undo", () => {
    for (let i = 0; i < 30; i++) col.addNote(basic().id, [`q${i}`, `a${i}`], [], 1);
    expect(countsFor(col, 1)).toEqual({ new: 20, learn: 0, review: 0 });
    const { next } = nextCard(col, 1);
    expect(next?.queue).toBe("new");
    answerCard(col, next!.card.id, 3, 2000);
    expect(countsFor(col, 1).new).toBe(19);
    expect(countsFor(col, 1).learn).toBe(1);
    const u = undo(col);
    expect(u?.cardId).toBe(next!.card.id);
    expect(countsFor(col, 1)).toEqual({ new: 20, learn: 0, review: 0 });
    expect(col.db.query<any, []>("SELECT count(*) n FROM revlog").get().n).toBe(0);
  });
  test("home summary: today, streak, forecast", () => {
    for (let i = 0; i < 5; i++) col.addNote(basic().id, [`h${i}`, `a${i}`], [], 1);
    const empty = homeSummary(col);
    expect(empty.streak).toBe(0);
    expect(empty.cards.total).toBe(5);
    expect(empty.next7).toHaveLength(7);
    const { next } = nextCard(col, 1);
    answerCard(col, next!.card.id, 1, 3000);
    const h = homeSummary(col);
    expect(h.today.cards).toBe(1);
    expect(h.today.again).toBe(1);
    expect(h.streak).toBe(1);
    expect(h.last14[13].count).toBe(1);
    expect(h.next7[0].count).toBe(1); // the relearning card is due today
  });
  test("home summary: card-state trend rebuilt from the review log", () => {
    for (let i = 0; i < 4; i++) col.addNote(basic().id, [`t${i}`, `a${i}`], [], 1);
    const [a, b, c, d] = col.db.query<{ id: number }, []>("SELECT id FROM cards ORDER BY id").all().map((r) => r.id);
    const at = (daysAgo: number, n = 0) => (NOW - daysAgo * 86400) * 1000 + n;
    const log = col.db.query("INSERT INTO revlog(id,cid,ease,ivl,last_ivl,factor,time,type) VALUES (?,?,?,?,?,?,0,?)");
    // a: learning 10 days ago, young the next day, mature 3 days ago
    log.run(at(10), a, 1, -600, 0, 0, 0);
    log.run(at(9), a, 3, 4, -600, 2500, 0);
    log.run(at(3), a, 3, 25, 4, 2500, 1);
    col.db.query("UPDATE cards SET type=2, queue=2, ivl=25 WHERE id=?").run(a);
    // b: young 5 days ago, then forgotten (no log entry) → new again today
    log.run(at(5), b, 3, 2, 0, 2500, 0);
    // c: young but suspended → left out
    log.run(at(5, 1), c, 3, 2, 0, 2500, 0);
    col.db.query("UPDATE cards SET type=2, queue=-1, ivl=2 WHERE id=?").run(c);
    // d: lapsed into relearning yesterday
    log.run(at(8), d, 3, 30, 0, 2500, 0);
    log.run(at(1), d, 1, -600, 30, 2500, 1);
    col.db.query("UPDATE cards SET type=3, queue=1, ivl=1 WHERE id=?").run(d);

    const { trend } = homeSummary(col);
    expect(trend).toHaveLength(TREND_DAYS);
    const ago = (n: number) => trend[trend.length - 1 - n];
    expect(ago(11)).toMatchObject({ learning: 0, young: 0, mature: 0 });
    expect(ago(10)).toMatchObject({ learning: 1, young: 0, mature: 0 });
    expect(ago(8)).toMatchObject({ learning: 0, young: 1, mature: 1 });
    expect(ago(5)).toMatchObject({ learning: 0, young: 2, mature: 1 });
    expect(ago(3)).toMatchObject({ learning: 0, young: 1, mature: 2 });
    expect(ago(1)).toMatchObject({ learning: 1, young: 1, mature: 1 });
    expect(ago(0)).toMatchObject({ learning: 1, young: 0, mature: 1, day: 0 });
  });
  test("subdeck limits roll up to parent", () => {
    const a = col.ensureDeck("P::A");
    const b = col.ensureDeck("P::B");
    for (let i = 0; i < 15; i++) {
      col.addNote(basic().id, [`a${i}`, "x"], [], a.id);
      col.addNote(basic().id, [`b${i}`, "x"], [], b.id);
    }
    const parent = col.deckByName("P")!;
    expect(countsFor(col, a.id).new).toBe(15);
    expect(countsFor(col, parent.id).new).toBe(20);
  });
  test("bury siblings", () => {
    const id = col.deckConfig(1);
    col.saveDeckConfig({ ...id, buryNew: true });
    col.addNote(col.notetypeByName("Basic (and reversed card)")!.id, ["f", "b"], [], 1);
    const { next } = nextCard(col, 1);
    answerCard(col, next!.card.id, 4, 1000);
    expect(col.db.query<any, []>("SELECT count(*) n FROM cards WHERE queue=-2").get().n).toBe(1);
  });
  test("leech tagging", () => {
    col.setConfig({ fsrs: false });
    const conf = col.deckConfig(1);
    col.saveDeckConfig({ ...conf, leechThreshold: 1, leechAction: 0 });
    col.addNote(basic().id, ["q", "a"], [], 1);
    const c = col.db.query<any, []>("SELECT * FROM cards").get();
    col.db.query("UPDATE cards SET type=2, queue=2, ivl=10, due=?, factor=2500 WHERE id=?").run(col.today(), c.id);
    const r = answerCard(col, c.id, 1, 1000);
    expect(r.leech).toBe(true);
    expect(col.card(c.id)!.queue).toBe(-1);
    expect(col.note(c.nid)!.tags).toContain("leech");
  });
});

describe("templates", () => {
  test("basic, conditionals and FrontSide", () => {
    const nt = col.notetypeByName("Basic (optional reversed card)")!;
    expect(cardOrdsForNote(nt, ["a", "b", ""])).toEqual([0]);
    expect(cardOrdsForNote(nt, ["a", "b", "y"])).toEqual([0, 1]);
    const r = renderCard(nt, ["Front!", "Back!", ""], 0, { tags: "", deck: "D", flag: 0, cardId: 1 });
    expect(r.question).toBe("Front!");
    expect(r.answer).toContain("Front!");
    expect(r.answer).toContain("Back!");
  });
  test("cloze incl. nested and hints", () => {
    expect(renderCloze("{{c1::a::hint}} {{c2::b}}", 1, true)).toContain("[hint]");
    expect(renderCloze("{{c1::a::hint}} {{c2::b}}", 1, true)).toContain(">b<");
    const nested = "{{c1::outer {{c2::inner}} text}}";
    expect(renderCloze(nested, 2, true)).toContain("outer");
    expect(renderCloze(nested, 2, true)).toContain("[...]");
    expect(renderCloze(nested, 1, false)).toContain("inner");
    const cloze = col.notetypeByName("Cloze")!;
    expect(cardOrdsForNote(cloze, ["{{c1::x}} {{c3::y}}", ""])).toEqual([0, 2]);
  });
  test("type answer comparison", () => {
    const html = compareTypedAnswer("hello", "helo");
    expect(html).toContain("typeGood");
    expect(html).toContain("typeMissed");
    const nt = col.notetypeByName("Basic (type in the answer)")!;
    const r = renderCard(nt, ["q", "answer"], 0, { tags: "", deck: "", flag: 0, cardId: 1 });
    expect(r.question).toContain('id="typeans"');
    expect(r.typeAnswer?.expected).toBe("answer");
  });
  test("page builder handles sounds", () => {
    const p = buildCardPage({ html: "x [sound:a.mp3]", css: "", ord: 0, night: true, mediaBase: "http://h/media/_/", autoplay: true, side: "question" });
    expect(p).toContain("replay-button");
    expect(p).toContain("nightMode");
    expect(p).toContain('<base href="http://h/media/_/">');
  });
});

describe("search", () => {
  test("common Anki search syntax", () => {
    const d = col.ensureDeck("Lang::Spanish");
    col.addNote(basic().id, ["perro", "dog"], ["animal", "es::noun"], d.id);
    col.addNote(basic().id, ["gato", "cat"], ["animal"], 1);
    col.addNote(basic().id, ["casa <b>grande</b>", "big house"], [], 1);
    expect(searchCardIds(col, "perro").length).toBe(1);
    expect(searchCardIds(col, "deck:Lang").length).toBe(1);
    expect(searchCardIds(col, "tag:animal").length).toBe(2);
    expect(searchCardIds(col, "tag:es").length).toBe(1);
    expect(searchCardIds(col, "-tag:animal").length).toBe(1);
    expect(searchCardIds(col, "gato or perro").length).toBe(2);
    expect(searchCardIds(col, "front:gato").length).toBe(1);
    expect(searchCardIds(col, "back:*house").length).toBe(1);
    expect(searchCardIds(col, '"casa grande"').length).toBe(1);
    expect(searchCardIds(col, "is:new").length).toBe(3);
    expect(searchCardIds(col, "(dog or cat) -gato").length).toBe(1);
    expect(searchCardIds(col, "c*a").length).toBeGreaterThanOrEqual(2);
    expect(searchCardIds(col, "added:1").length).toBe(3);
  });
});

describe("import/export", () => {
  test("modern .apkg (anki21b, zstd, protobuf)", () => {
    const res = importApkg(col, fixture("modern.apkg"));
    expect(res.notesAdded).toBe(8);
    expect(res.cardsAdded).toBe(15);
    expect(res.media).toBe(2);
    expect(col.deckByName("Languages::Spanish")).toBeTruthy();
    expect(col.notetypeByName("Cloze")).toBeTruthy();
    expect(col.media.read("red square.png")?.length).toBeGreaterThan(10);
    expect(col.db.query<any, []>("SELECT count(*) n FROM revlog").get().n).toBeGreaterThan(0);
    expect(col.db.query<any, []>("SELECT count(*) n FROM cards WHERE queue=-1").get().n).toBe(1);
    expect(col.db.query<any, []>("SELECT count(*) n FROM cards WHERE flags=2").get().n).toBe(1);
    expect(col.db.query<any, []>("SELECT count(*) n FROM cards WHERE stability IS NOT NULL").get().n).toBeGreaterThan(0);
    const science = col.deckByName("Science")!;
    expect(col.deckConfig(science.configId).name).toBe("Intense");
    expect(col.deckConfig(science.configId).learnSteps).toEqual([1, 5, 15]);
    // reimport is idempotent
    const again = importApkg(col, fixture("modern.apkg"));
    expect(again.notesAdded).toBe(0);
    expect(col.counts().notes).toBe(8);
  });
  test("legacy .apkg (anki21, JSON)", () => {
    const res = importApkg(col, fixture("legacy.apkg"));
    expect(res.notesAdded).toBe(8);
    expect(res.cardsAdded).toBe(15);
    expect(col.media.has("beep.mp3")).toBe(true);
  });
  test(".colpkg", () => {
    const res = importApkg(col, fixture("full.colpkg"));
    expect(res.notesAdded).toBe(8);
  });
  test("export round-trip", () => {
    importApkg(col, fixture("modern.apkg"));
    const data = exportApkg(col, { includeScheduling: true, includeMedia: true });
    const dir2 = mkdtempSync(join(tmpdir(), "ba-test2-"));
    const col2 = new Collection(dir2, randomKey(), { autoFlush: false });
    const res = importApkg(col2, data);
    expect(res.notesAdded).toBe(8);
    expect(res.cardsAdded).toBe(15);
    expect(res.media).toBe(2);
    expect(col2.db.query<any, []>("SELECT count(*) n FROM cards WHERE type=2").get().n).toBe(col.db.query<any, []>("SELECT count(*) n FROM cards WHERE type=2").get().n);
    col2.close();
    rmSync(dir2, { recursive: true, force: true });
  });
  test("csv import", () => {
    const text = "#separator:tab\n#html:false\nhello\tworld\tt1 t2\nfoo\tbar\t\n";
    const pv = previewCsv(text);
    expect(pv.delimiter).toBe("\t");
    const r = importCsv(col, text, { notetypeId: basic().id, deckId: 1, fieldColumns: [0, 1], tagsColumn: 2 });
    expect(r.added).toBe(2);
    const r2 = importCsv(col, text, { notetypeId: basic().id, deckId: 1, fieldColumns: [0, 1], tagsColumn: 2, dupeMode: "ignore" });
    expect(r2.skipped).toBe(2);
  });
});

describe("decks & ops", () => {
  test("rename moves children, filtered decks", () => {
    col.ensureDeck("A::B::C");
    const a = col.deckByName("A")!;
    col.renameDeck(a.id, "Z");
    expect(col.deckByName("Z::B::C")).toBeTruthy();
    for (let i = 0; i < 5; i++) col.addNote(basic().id, [`q${i}`, "a"], ["x"], col.deckByName("Z::B")!.id);
    const f = createFiltered(col, "Filt", { terms: [{ search: "tag:x", limit: 3, order: 5 }] });
    expect(col.db.query<any, [number]>("SELECT count(*) n FROM cards WHERE did=?").get(f.id).n).toBe(3);
    const { next } = nextCard(col, f.id);
    expect(next).toBeTruthy();
    col.emptyFiltered(f.id);
    expect(col.db.query<any, [number]>("SELECT count(*) n FROM cards WHERE did=?").get(f.id).n).toBe(0);
    expect(deckTree(col).length).toBeGreaterThan(0);
  });
  test("custom study + card actions + undo", () => {
    for (let i = 0; i < 25; i++) col.addNote(basic().id, [`q${i}`, "a"], [], 1);
    customStudy(col, { mode: "newLimit", deckId: 1, value: 5 });
    expect(countsFor(col, 1).new).toBe(25);
    const ids = col.db.query<any, []>("SELECT id FROM cards LIMIT 3").all().map((r: any) => r.id);
    cardAction(col, { action: "suspend", cardIds: ids });
    expect(countsFor(col, 1).new).toBe(22);
    undo(col);
    expect(countsFor(col, 1).new).toBe(25);
    cardAction(col, { action: "setDue", cardIds: ids, days: "0" });
    expect(countsFor(col, 1).review).toBe(3);
  });
  test("notetype field changes migrate notes", () => {
    const nt = col.cloneNotetype(basic().id, "Mine");
    const { id } = col.addNote(nt.id, ["F", "B"], [], 1);
    col.updateNotetype(nt.id, {
      fields: [
        { name: "Back", ord: 1, origOrd: 1 },
        { name: "Extra", ord: 2, origOrd: null },
        { name: "Front", ord: 0, origOrd: 0 },
      ],
    });
    expect(splitFields(col.note(id)!.flds)).toEqual(["B", "", "F"]);
    const t = col.notetype(nt.id)!;
    col.updateNotetype(nt.id, { templates: [...t.templates.map((x) => ({ ...x, origOrd: x.ord })), { name: "Rev", ord: 1, qfmt: "{{Back}}", afmt: "{{Front}}", origOrd: null }] });
    expect(col.cardsOfNote(id).length).toBe(2);
  });
  test("check database and empty cards", () => {
    col.addNote(basic().id, ["a", "b"], [], 1);
    expect(checkDatabase(col).report.length).toBeGreaterThan(0);
    expect(findEmptyCards(col).length).toBe(0);
  });
});

describe("optimizer", () => {
  test("fits synthetic data better than defaults", () => {
    // synthetic learner who forgets faster than the default model predicts
    const seqs: [number, number][][] = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const seq: [number, number][] = [[0, 3]];
      let s = 1;
      for (let k = 0; k < 6; k++) {
        const dt = Math.max(1, Math.round(s * 1.5));
        const r = Math.pow(0.9, dt / s);
        const ok = rnd() < r;
        seq.push([dt, ok ? 3 : 1]);
        s = ok ? s * 2 : Math.max(0.5, s * 0.4);
      }
      seqs.push(seq);
    }
    const res = optimize(seqs, undefined, { steps: 40, batch: 200 });
    expect(res.reviews).toBeGreaterThan(100);
    expect(res.logLoss).toBeLessThanOrEqual(res.defaultLogLoss);
  });
});
