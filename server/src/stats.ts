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
