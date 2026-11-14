// Anki-compatible card template rendering.
import type { Notetype } from "../types";
import { escapeHtml, stripHtml, decodeEntities } from "../util";
import { clozeNumbersInText, renderCloze, clozeOnlyText, clozeAnswersForTyping } from "./cloze";

type Node =
  | { t: "text"; v: string }
  | { t: "var"; name: string; filters: string[] }
  | { t: "section"; name: string; inverted: boolean; children: Node[] };

const parseCache = new Map<string, Node[]>();

export function parseTemplate(src: string): Node[] {
  const cached = parseCache.get(src);
  if (cached) return cached;
  const root: Node[] = [];
  const stack: { name: string; nodes: Node[] }[] = [{ name: "", nodes: root }];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) stack[stack.length - 1].nodes.push({ t: "text", v: src.slice(last, m.index) });
    last = m.index + m[0].length;
    const inner = m[1].trim();
    if (inner.startsWith("#") || inner.startsWith("^")) {
      const sec: Node = { t: "section", name: inner.slice(1).trim(), inverted: inner[0] === "^", children: [] };
      stack[stack.length - 1].nodes.push(sec);
      stack.push({ name: sec.name, nodes: sec.children });
    } else if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
      else stack[stack.length - 1].nodes.push({ t: "text", v: m[0] }); // unbalanced: keep literal
    } else if (inner.startsWith("!")) {
      // comment
    } else {
      const parts = inner.split(":");
      const name = parts.pop()!.trim();
      stack[stack.length - 1].nodes.push({ t: "var", name, filters: parts.map((p) => p.trim()) });
    }
  }
  if (last < src.length) stack[stack.length - 1].nodes.push({ t: "text", v: src.slice(last) });
  if (parseCache.size > 500) parseCache.clear();
  parseCache.set(src, root);
  return root;
}

export interface RenderContext {
  fields: Record<string, string>; // field name -> html (also special fields)
  cardOrd: number; // 0-based
  isCloze: boolean;
  question: boolean;
  frontSide?: string;
  /** Set when {{type:...}} is encountered. */
  typeAnswer?: { field: string; expected: string; cloze: boolean };
  /** Tracks whether any non-empty field was substituted (card generation). */
  nonEmptyField?: boolean;
}

function fieldNonEmpty(v: string | undefined): boolean {
  if (!v) return false;
  return stripHtml(v.replace(/<img|<audio|<video|\[sound:/gi, "x")).trim().length > 0;
}

const SPECIAL_FIELDS = new Set(["FrontSide", "Tags", "Type", "Deck", "Subdeck", "Card", "CardFlag", "CardID"]);

export function renderNodes(nodes: Node[], ctx: RenderContext): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "section") {
      const v = ctx.fields[n.name];
      let nonEmpty = fieldNonEmpty(v);
      // Anki: {{#c1}} sections in cloze notetypes test the active cloze ordinal
      const cm = /^c(\d+)$/.exec(n.name);
      if (ctx.isCloze && cm && v === undefined) nonEmpty = Number(cm[1]) === ctx.cardOrd + 1;
      if (nonEmpty !== n.inverted) out += renderNodes(n.children, ctx);
    } else out += renderVar(n.name, n.filters, ctx);
  }
  return out;
}

function renderVar(name: string, filters: string[], ctx: RenderContext): string {
  if (name === "FrontSide") return ctx.question ? "" : (ctx.frontSide ?? "");
  let value = ctx.fields[name];
  if (value === undefined) {
    if (filters.length === 0 && name === "") return "";
    // Unknown field -> show error like Anki
    if (!filters.includes("tts") && !SPECIAL_FIELDS.has(name))
      return `<span class="template-error">{unknown field ${escapeHtml(name)}}</span>`;
    value = "";
  }
  if (!SPECIAL_FIELDS.has(name) && fieldNonEmpty(value)) ctx.nonEmptyField = true;
  // filters apply right-to-left
  for (let i = filters.length - 1; i >= 0; i--) {
    const f = filters[i];
    const isLast = i === 0;
    switch (f) {
      case "text":
        value = stripHtml(value);
        break;
      case "cloze":
        if (ctx.isCloze) value = renderCloze(value, ctx.cardOrd + 1, ctx.question);
        break;
      case "cloze-only":
        value = clozeOnlyText(value, ctx.cardOrd + 1);
        break;
      case "type": {
        const isCloze = filters.includes("cloze") || filters[i + 1] === "cloze";
        const raw = ctx.fields[name] ?? "";
        const expected = ctx.isCloze && (isCloze || filters.some((x) => x === "cloze"))
          ? clozeAnswersForTyping(raw, ctx.cardOrd + 1)
          : stripHtml(raw);
        ctx.typeAnswer = { field: name, expected, cloze: isCloze };
        return ctx.question ? `<input type="text" id="typeans" autocomplete="off" autocapitalize="off" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();window.__ba&&window.__ba.send('showAnswer')}">` : "[[type:compare]]";
      }
      case "hint": {
        if (!fieldNonEmpty(value)) return "";
        const id = "hint" + Math.floor(Math.random() * 1e9);
        value = `<a class="hint" href="#" onclick="this.style.display='none';document.getElementById('${id}').style.display='block';window.scrollTo(0, document.body.scrollHeight);return false;" draggable="false">${escapeHtml(name)}</a><div id="${id}" class="hint" style="display: none">${value}</div>`;
        break;
      }
      case "furigana":
        value = furigana(value, "furigana");
        break;
      case "kana":
        value = furigana(value, "kana");
        break;
      case "kanji":
        value = furigana(value, "kanji");
        break;
      case "nc":
        value = value.normalize("NFD").replace(/[̀-ͯ]/g, "");
        break;
      case "tts":
        // Text-to-speech filters: emit a tts tag the client can speak via the Web Speech API
        value = `[anki:tts lang=${filters.find((x) => x.startsWith("lang="))?.slice(5) ?? ""}]${stripHtml(value)}[/anki:tts]`;
        return value;
      default:
        if (f.startsWith("tts") || f.startsWith("lang=") || f.startsWith("voices=") || f.startsWith("speed=")) break;
        // unknown filter: ignore (Anki shows error; we are lenient)
        break;
    }
    void isLast;
  }
  return value;
}

function furigana(s: string, mode: "furigana" | "kana" | "kanji"): string {
  // Anki reading syntax: " 漢字[かんじ]"
  return s.replace(/ ?([^ >\[\]]+?)\[(.+?)\]/g, (_m, base: string, reading: string) => {
    if (reading.startsWith("sound:")) return _m;
    if (mode === "kana") return reading;
    if (mode === "kanji") return base;
    return `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`;
  });
}

/** Ordinals (0-based) of cards that should exist for a note. */
export function cardOrdsForNote(nt: Notetype, fields: string[]): number[] {
  if (nt.kind === 1) {
    const clozeFields = clozeFieldNames(nt);
    const nums = new Set<number>();
    nt.fields.forEach((f, i) => {
      if (clozeFields.has(f.name)) for (const n of clozeNumbersInText(fields[i] ?? "")) nums.add(n);
    });
    return [...nums].sort((a, b) => a - b).map((n) => n - 1);
  }
  const map = fieldMap(nt, fields);
  const out: number[] = [];
  nt.templates.forEach((t, i) => {
    const ctx: RenderContext = { fields: map, cardOrd: i, isCloze: false, question: true };
    renderNodes(parseTemplate(t.qfmt), ctx);
    if (ctx.nonEmptyField) out.push(i);
  });
  return out;
}

export function clozeFieldNames(nt: Notetype): Set<string> {
  const out = new Set<string>();
  for (const t of nt.templates)
    for (const m of t.qfmt.matchAll(/\{\{([^}]*?)\}\}/g)) {
      const parts = m[1].split(":").map((p) => p.trim());
      if (parts.slice(0, -1).includes("cloze")) out.add(parts[parts.length - 1]);
    }
  return out;
}

export function fieldMap(nt: Notetype, fields: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  nt.fields.forEach((f, i) => (map[f.name] = fields[i] ?? ""));
  return map;
}

export interface RenderedCard {
  question: string;
  answer: string;
  css: string;
  typeAnswer?: { expected: string };
}

export function renderCard(
  nt: Notetype,
  fields: string[],
  ord: number,
  extra: { tags: string; deck: string; flag: number; cardId: number },
  opts: { browser?: boolean } = {},
): RenderedCard {
  const tmpl = nt.kind === 1 ? nt.templates[0] : nt.templates[ord];
  if (!tmpl) return { question: `<div class="template-error">Card template ${ord + 1} is missing</div>`, answer: "", css: nt.css };
  const map = fieldMap(nt, fields);
  map.Tags = extra.tags.trim();
  map.Type = nt.name;
  map.Deck = extra.deck;
  map.Subdeck = extra.deck.split("::").pop() ?? "";
  map.Card = tmpl.name;
  map.CardFlag = extra.flag ? `flag${extra.flag}` : "";
  map.CardID = String(extra.cardId);
  const qfmt = opts.browser && tmpl.bqfmt ? tmpl.bqfmt : tmpl.qfmt;
  const afmt = opts.browser && tmpl.bafmt ? tmpl.bafmt : tmpl.afmt;
  const qctx: RenderContext = { fields: map, cardOrd: ord, isCloze: nt.kind === 1, question: true };
  let question = renderNodes(parseTemplate(qfmt), qctx);
  const actx: RenderContext = { fields: map, cardOrd: ord, isCloze: nt.kind === 1, question: false, frontSide: question };
  let answer = renderNodes(parseTemplate(afmt), actx);
  if (nt.kind === 1 && !question.includes('class="cloze"') && !/\{\{c\d+::/.test(fields.join(""))) {
    question += `<div class="template-error">No cloze ${ord + 1} found on card.</div>`;
  }
  // FrontSide embedding shouldn't duplicate the typing box
  answer = answer.replace(/<input type="text" id="typeans"[^>]*>/g, "");
  const typeAnswer = actx.typeAnswer ?? qctx.typeAnswer;
  return { question, answer, css: nt.css, typeAnswer: typeAnswer ? { expected: typeAnswer.expected } : undefined };
}

/** Compare typed text with expected, Anki style. */
export function compareTypedAnswer(expected: string, typed: string): string {
  expected = decodeEntities(expected).trim();
  typed = typed.trim();
  if (!typed) return `<code id="typeans">${escapeHtml(expected)}</code>`;
  if (typed === expected) return `<code id="typeans"><span class="typeGood">${escapeHtml(expected)}</span></code>`;
  // LCS-based character diff
  const a = [...typed];
  const b = [...expected];
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0,
    j = 0;
  const typedOut: [string, string][] = [];
  const expOut: [string, string][] = [];
  const push = (arr: [string, string][], cls: string, ch: string) => {
    if (arr.length && arr[arr.length - 1][0] === cls) arr[arr.length - 1][1] += ch;
    else arr.push([cls, ch]);
  };
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(typedOut, "typeGood", a[i]);
      push(expOut, "typeGood", b[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(typedOut, "typeBad", a[i]);
      i++;
    } else {
      push(typedOut, "typeMissed", "-");
      push(expOut, "typeMissed", b[j]);
      j++;
    }
  }
  while (i < a.length) push(typedOut, "typeBad", a[i++]);
  while (j < b.length) {
    push(typedOut, "typeMissed", "-");
    push(expOut, "typeMissed", b[j++]);
  }
  const html = (arr: [string, string][]) => arr.map(([c, t]) => `<span class="${c}">${escapeHtml(t)}</span>`).join("");
  return `<code id="typeans">${html(typedOut)}<br><span id="typearrow">&darr;</span><br>${html(expOut)}</code>`;
}
