// Statistics (Anki's "Stats" screen plus extras: heatmap, streaks, true retention, FSRS).
import type { Collection } from "./collection";
import { dayNumber, nowSecs, localOffsetSecs } from "./util";
import { FSRS } from "./sched/fsrs";
import { studiedToday } from "./sched/queue";

export function collectionStats(col: Collection, deckId: number | null, rangeDays: number) {
  const roll = col.config.rolloverHour;
  const today = col.today();
  const now = nowSecs();
  const ids = deckId ? col.deckAndChildren(deckId) : null;
  const cardWhere = ids ? `(did IN (${ids.join(",")}) OR odid IN (${ids.join(",")}))` : "1=1";
  const revWhere = ids ? `cid IN (SELECT id FROM cards WHERE ${cardWhere})` : "1=1";
  const db = col.db;

  // ---- card counts ----
  const counts = db
    .query<Record<string, number>, []>(
      `SELECT coalesce(sum(type=0 AND queue>=0),0) new, coalesce(sum(type=1 AND queue>=0),0) learning,
       coalesce(sum(type=3 AND queue>=0),0) relearning, coalesce(sum(type=2 AND ivl<21 AND queue>=0),0) young,
       coalesce(sum(type=2 AND ivl>=21 AND queue>=0),0) mature, coalesce(sum(queue=-1),0) suspended,
       coalesce(sum(queue IN (-2,-3)),0) buried, count(*) total FROM cards WHERE ${cardWhere}`,
    )
    .get()!;

  // ---- review history (per day) ----
  const startDay = today - rangeDays + 1;
  const dayOf = (ms: number) => dayNumber(Math.floor(ms / 1000), roll);
  const revs = db
    .query<{ id: number; ease: number; type: number; time: number; last_ivl: number; ivl: number }, [number]>(
      `SELECT id, ease, type, time, last_ivl, ivl FROM revlog WHERE ${revWhere} AND id >= ? AND ease > 0 AND type != 4 ORDER BY id`,
    )
    .all((now - (rangeDays + 1) * 86400) * 1000);
  const history = new Map<number, { learn: number; young: number; mature: number; relearn: number; filtered: number; timeMs: number }>();
  const hours = Array.from({ length: 24 }, () => ({ total: 0, correct: 0 }));
  const buttons = {
    learning: [0, 0, 0, 0],
    young: [0, 0, 0, 0],
    mature: [0, 0, 0, 0],
  };
  for (const r of revs) {
    const d = dayOf(r.id);
    if (d < startDay) continue;
    const h = history.get(d) ?? { learn: 0, young: 0, mature: 0, relearn: 0, filtered: 0, timeMs: 0 };
    if (r.type === 0) h.learn++;
    else if (r.type === 2) h.relearn++;
    else if (r.type === 3) h.filtered++;
    else if (r.last_ivl >= 21) h.mature++;
    else h.young++;
    h.timeMs += r.time;
    history.set(d, h);
    const hour = new Date((Math.floor(r.id / 1000) + localOffsetSecs(Math.floor(r.id / 1000))) * 1000).getUTCHours();
    hours[hour].total++;
    if (r.ease > 1) hours[hour].correct++;
    const bucket = r.type === 0 || r.type === 2 ? buttons.learning : r.last_ivl >= 21 ? buttons.mature : buttons.young;
    if (r.ease >= 1 && r.ease <= 4) bucket[r.ease - 1]++;
  }
  const historyArr = [];
  for (let d = startDay; d <= today; d++) historyArr.push({ day: d - today, ...(history.get(d) ?? { learn: 0, young: 0, mature: 0, relearn: 0, filtered: 0, timeMs: 0 }) });

  // ---- heatmap: whole year regardless of range ----
  const yearRows = db
    .query<{ id: number }, [number]>(`SELECT id FROM revlog WHERE ${revWhere} AND id >= ? AND ease > 0 AND type != 4`)
    .all((now - 372 * 86400) * 1000);
  const heat = new Map<number, number>();
  for (const r of yearRows) {
    const d = dayOf(r.id);
    heat.set(d, (heat.get(d) ?? 0) + 1);
  }
  const heatmap = [];
  for (let d = today - 364; d <= today; d++) heatmap.push({ day: d - today, date: dateOfDay(d), count: heat.get(d) ?? 0 });
  // streak
  let streak = 0;
  for (let d = today; ; d--) {
    if (heat.get(d)) streak++;
    else if (d === today) continue;
    else break;
    if (streak > 400) break;
  }
  const allDays = db
    .query<{ id: number }, []>(`SELECT id FROM revlog WHERE ${revWhere} AND ease > 0 AND type != 4`)
    .all()
    .map((r) => dayOf(r.id));
  const daysStudied = new Set(allDays).size;
  let longest = 0,
    run = 0,
    prev: number | null = null;
  for (const d of [...new Set(allDays)].sort((a, b) => a - b)) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  // ---- forecast ----
  const fRows = db
    .query<{ due: number; queue: number; ivl: number }, [number]>(
      `SELECT CASE WHEN odid!=0 AND odue!=0 THEN odue ELSE due END due, queue, ivl FROM cards WHERE ${cardWhere} AND queue IN (1,2,3) AND (queue=1 OR (CASE WHEN odid!=0 AND odue!=0 THEN odue ELSE due END) <= ?)`,
    )
    .all(today + rangeDays);
  const forecast = Array.from({ length: Math.min(rangeDays, 365) + 1 }, (_, i) => ({ day: i, young: 0, mature: 0, learn: 0 }));
  for (const r of fRows) {
    let d = r.queue === 1 ? Math.max(0, dayNumber(r.due, roll) - today) : Math.max(0, r.due - today);
    if (d >= forecast.length) continue;
    if (r.queue === 1 || r.queue === 3) forecast[d].learn++;
    else if (r.ivl >= 21) forecast[d].mature++;
    else forecast[d].young++;
    void d;
  }
  const dueTomorrow = forecast[1] ? forecast[1].young + forecast[1].mature + forecast[1].learn : 0;
  const overdue = db
    .query<{ n: number }, [number]>(`SELECT count(*) n FROM cards WHERE ${cardWhere} AND queue=2 AND due < ?`)
    .get(today)!.n;

  // ---- interval / ease / FSRS distributions ----
  const fsrs = new FSRS();
  const cards = db
    .query<{ ivl: number; factor: number; stability: number | null; difficulty: number | null; last_review: number | null }, []>(
      `SELECT ivl, factor, stability, difficulty, last_review FROM cards WHERE ${cardWhere} AND type=2 AND queue>=-1`,
    )
    .all();
  const intervals = histogram(cards.map((c) => c.ivl), [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 730, 1095, 1825, Infinity]);
  const eases = histogram(cards.filter((c) => c.factor > 0).map((c) => c.factor / 10), [130, 150, 170, 190, 210, 230, 250, 270, 290, 310, 330, Infinity]);
  const withMem = cards.filter((c) => c.stability != null && c.difficulty != null);
  const difficulty = histogram(withMem.map((c) => ((c.difficulty! - 1) / 9) * 100), [10, 20, 30, 40, 50, 60, 70, 80, 90, 101]);
  const stability = histogram(withMem.map((c) => c.stability!), [1, 2, 3, 5, 7, 10, 14, 21, 30, 60, 90, 180, 365, 730, Infinity]);
  const retrs = withMem.filter((c) => c.last_review).map((c) => fsrs.retrievability(today - dayNumber(c.last_review!, roll), c.stability!) * 100);
  const retrievability = histogram(retrs, [50, 60, 70, 75, 80, 85, 90, 95, 101]);
  const avgRetention = retrs.length ? retrs.reduce((a, b) => a + b, 0) / retrs.length : null;

  // ---- added ----
  const added = db
    .query<{ id: number }, [number]>(`SELECT id FROM cards WHERE ${cardWhere} AND id >= ?`)
    .all((now - rangeDays * 86400) * 1000);
  const addedMap = new Map<number, number>();
  for (const r of added) {
    const d = dayOf(r.id);
    addedMap.set(d, (addedMap.get(d) ?? 0) + 1);
  }
  const addedArr = [];
  for (let d = startDay; d <= today; d++) addedArr.push({ day: d - today, count: addedMap.get(d) ?? 0 });

  // ---- true retention ----
  const retentionPeriods = [
    ["Today", 1],
    ["Yesterday", 2],
    ["Last week", 7],
    ["Last month", 30],
    ["Last year", 365],
  ] as const;
  const retention = retentionPeriods.map(([label, days]) => {
    const fromDay = label === "Yesterday" ? today - 1 : today - days + 1;
    const toDay = label === "Yesterday" ? today - 1 : today;
    let yp = 0,
      yf = 0,
      mp = 0,
      mf = 0;
    for (const r of revs.length && days <= rangeDays ? revs : db.query<{ id: number; ease: number; type: number; time: number; last_ivl: number; ivl: number }, [number]>(`SELECT id, ease, type, time, last_ivl, ivl FROM revlog WHERE ${revWhere} AND id >= ? AND ease>0 AND type=1`).all((now - (days + 1) * 86400) * 1000)) {
      if (r.type !== 1) continue;
      const d = dayOf(r.id);
      if (d < fromDay || d > toDay) continue;
      if (r.last_ivl >= 21) r.ease > 1 ? mp++ : mf++;
      else r.ease > 1 ? yp++ : yf++;
    }
    const pct = (p: number, f: number) => (p + f ? (p / (p + f)) * 100 : null);
    return { label, young: pct(yp, yf), mature: pct(mp, mf), total: pct(yp + mp, yf + mf), count: yp + yf + mp + mf };
  });

  const totalReviews = historyArr.reduce((a, h) => a + h.learn + h.young + h.mature + h.relearn + h.filtered, 0);
  const totalTime = historyArr.reduce((a, h) => a + h.timeMs, 0);
  return {
    today: studiedToday(col),
    counts,
    history: historyArr,
    heatmap,
    streak,
    longestStreak: longest,
    daysStudied,
    forecast,
    dueTomorrow,
    overdue,
    intervals,
    avgInterval: cards.length ? cards.reduce((a, c) => a + c.ivl, 0) / cards.length : 0,
    maxInterval: cards.reduce((a, c) => Math.max(a, c.ivl), 0),
    eases,
    avgEase: cards.filter((c) => c.factor > 0).length ? cards.filter((c) => c.factor > 0).reduce((a, c) => a + c.factor, 0) / cards.filter((c) => c.factor > 0).length / 10 : null,
    difficulty,
    stability,
    retrievability,
    avgRetention,
    hours,
    buttons,
    added: addedArr,
    retention,
    summary: {
      totalReviews,
      totalTimeMs: totalTime,
      avgPerDay: totalReviews / rangeDays,
      avgSecsPerCard: totalReviews ? totalTime / totalReviews / 1000 : 0,
    },
    fsrs: col.config.fsrs,
  };
}

function histogram(values: number[], edges: number[]) {
  const out = edges.map((e, i) => ({ from: i === 0 ? 0 : edges[i - 1], to: e, count: 0 }));
  for (const v of values) {
    const i = edges.findIndex((e) => v < e);
    if (i >= 0) out[i].count++;
  }
  return out;
}

function dateOfDay(day: number): string {
  return new Date(day * 86400 * 1000).toISOString().slice(0, 10);
}

/** Days of history in the home screen's card-state trend. */
export const TREND_DAYS = 90;

// Card states for the trend: 0 = new (not plotted), 1 = learning or relearning, 2 = young, 3 = mature.
const reviewState = (ivl: number) => (ivl >= 21 ? 3 : 2);
const currentState = (type: number, ivl: number) => (type === 0 ? 0 : type === 1 || type === 3 ? 1 : reviewState(ivl));
/** A card's state after a review-log entry (ivl > 0 is days, ivl < 0 is a learning step in seconds). */
function stateAfter(prev: number, type: number, ivl: number): number {
  if (type >= 4) return ivl > 0 ? reviewState(ivl) : ivl === 0 ? 0 : prev; // set due date, or forget (ivl 0)
  if (ivl > 0) return reviewState(ivl);
  if (type === 0 || type === 2 || (type === 1 && ivl < 0)) return 1;
  return prev; // filtered-deck preview: the card's scheduling is unchanged
}

type RevRow = { id: number; cid: number; ease: number; type: number; ivl: number };

/**
 * Cards per state (learning, young, mature) at the end of each of the last TREND_DAYS days, rebuilt from the
 * review log. `deckIds` limits it to those decks (cards in a filtered deck count for their home deck too);
 * suspended cards are left out. With no deck filter, `visit` sees every review-log row, so callers can share the pass.
 */
export function cardStateTrend(col: Collection, deckIds: number[] | null, visit?: (r: RevRow, day: number) => void) {
  const roll = col.config.rolloverHour;
  const today = col.today();
  const db = col.db;
  const inDecks = deckIds ? `AND (did IN (${deckIds.join(",")}) OR odid IN (${deckIds.join(",")}))` : "";

  // plotted cards, with their state now
  const current = new Map<number, number>();
  for (const c of db.query<{ id: number; type: number; ivl: number }, []>(`SELECT id, type, ivl FROM cards WHERE queue != -1 ${inDecks}`).iterate()) {
    current.set(c.id, currentState(c.type, c.ivl));
  }
  // each day's net change in the number of cards per state; changes before the window go into `base`
  const start = today - TREND_DAYS + 1;
  const base = [0, 0, 0, 0];
  const deltas = Array.from({ length: TREND_DAYS }, () => [0, 0, 0, 0]);
  const move = (day: number, from: number, to: number) => {
    if (from === to) return;
    const slot = day < start ? base : deltas[Math.min(day, today) - start];
    slot[from]--;
    slot[to]++;
  };
  const states = new Map<number, number>();
  const revWhere = deckIds && !visit ? `WHERE cid IN (SELECT id FROM cards WHERE queue != -1 ${inDecks})` : "";
  for (const r of db.query<RevRow, []>(`SELECT id, cid, ease, type, ivl FROM revlog ${revWhere} ORDER BY id`).iterate()) {
    const d = dayNumber(Math.floor(r.id / 1000), roll);
    visit?.(r, d);
    if (current.has(r.cid)) {
      const prev = states.get(r.cid) ?? 0;
      const next = stateAfter(prev, r.type, r.ivl);
      move(d, prev, next);
      states.set(r.cid, next);
    }
  }
  // The log can disagree with the card table (forget writes no entry, imports may lack history): today's point uses the real state.
  for (const [cid, state] of current) move(today, states.get(cid) ?? 0, state);
  const counts = base.slice();
  return deltas.map((delta, i) => {
    for (let s = 1; s < 4; s++) counts[s] += delta[s];
    return { day: i - TREND_DAYS + 1, date: dateOfDay(start + i), learning: counts[1], young: counts[2], mature: counts[3] };
  });
}

/** Lightweight dashboard summary for the home screen (cheap enough to load on every visit). */
export function homeSummary(col: Collection) {
  const roll = col.config.rolloverHour;
  const today = col.today();
  const now = nowSecs();
  const db = col.db;

  // one chronological pass over the review log: card states, plus review days (streaks, retention)
  const perDay = new Map<number, number>();
  let passed = 0,
    failed = 0;
  const monthAgo = (now - 30 * 86400) * 1000;
  const trend = cardStateTrend(col, null, (r, d) => {
    if (r.ease > 0 && r.type !== 4) {
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
      if (r.type === 1 && r.id >= monthAgo) r.ease > 1 ? passed++ : failed++;
    }
  });
  let streak = 0;
  for (let d = today; ; d--) {
    if (perDay.get(d)) streak++;
    else if (d === today) continue;
    else break;
    if (streak > 3650) break;
  }
  let longest = 0,
    run = 0,
    prev: number | null = null;
  for (const d of [...perDay.keys()].sort((a, b) => a - b)) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = today - 13 + i;
    return { day: d - today, date: dateOfDay(d), count: perDay.get(d) ?? 0 };
  });

  // forecast for the next 7 days (today = day 0 includes overdue + learning)
  const fRows = db
    .query<{ due: number; queue: number }, [number]>(
      `SELECT CASE WHEN odid!=0 AND odue!=0 THEN odue ELSE due END due, queue FROM cards WHERE queue IN (1,2,3) AND (queue=1 OR (CASE WHEN odid!=0 AND odue!=0 THEN odue ELSE due END) <= ?)`,
    )
    .all(today + 7);
  const next7 = Array.from({ length: 7 }, (_, i) => ({ day: i, date: dateOfDay(today + i), count: 0 }));
  for (const r of fRows) {
    const d = r.queue === 1 ? Math.max(0, dayNumber(r.due, roll) - today) : Math.max(0, r.due - today);
    if (d < 7) next7[d].count++;
  }

  const cards = db
    .query<{ total: number; new: number; learning: number; young: number; mature: number; suspended: number }, []>(
      `SELECT count(*) total, coalesce(sum(type=0 AND queue>=0),0) new, coalesce(sum(type IN (1,3) AND queue>=0),0) learning,
       coalesce(sum(type=2 AND ivl<21 AND queue>=0),0) young, coalesce(sum(type=2 AND ivl>=21 AND queue>=0),0) mature,
       coalesce(sum(queue=-1),0) suspended FROM cards`,
    )
    .get()!;
  const notes = db.query<{ n: number }, []>("SELECT count(*) n FROM notes").get()!.n;

  return {
    today: studiedToday(col),
    streak,
    longestStreak: longest,
    daysStudied: perDay.size,
    last14,
    next7,
    trend,
    retention30: passed + failed ? (passed / (passed + failed)) * 100 : null,
    retentionCount: passed + failed,
    cards,
    notes,
  };
}
