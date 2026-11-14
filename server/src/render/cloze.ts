// Cloze parsing & rendering with support for nested clozes ({{c1::a {{c2::b}}}})
// and image-occlusion shapes.
import { escapeHtml, stripHtml } from "../util";

type ClozeNode = { t: "text"; v: string } | { t: "cloze"; ords: number[]; children: ClozeNode[]; hint: string | null };

function parse(text: string): ClozeNode[] {
  const root: ClozeNode[] = [];
  const stack: { node: ClozeNode & { t: "cloze" }; rawHint: string[] | null }[] = [];
  const cur = () => (stack.length ? stack[stack.length - 1].node.children : root);
  const re = /\{\{c([\d,]+)::|\}\}|::/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (s: string) => {
    if (!s) return;
    if (stack.length && stack[stack.length - 1].rawHint) stack[stack.length - 1].rawHint!.push(s);
    else cur().push({ t: "text", v: s });
  };
  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0].startsWith("{{c")) {
      const ords = m[1].split(",").map(Number).filter((n) => n > 0);
      const node: ClozeNode & { t: "cloze" } = { t: "cloze", ords, children: [], hint: null };
      if (stack.length && stack[stack.length - 1].rawHint) {
        // cloze inside a hint: treat literally
        stack[stack.length - 1].rawHint!.push(m[0]);
        continue;
      }
      cur().push(node);
      stack.push({ node, rawHint: null });
    } else if (m[0] === "::") {
      if (stack.length && !stack[stack.length - 1].rawHint) stack[stack.length - 1].rawHint = [];
      else pushText("::");
    } else {
      // "}}"
      if (stack.length) {
        const top = stack.pop()!;
        if (top.rawHint) top.node.hint = top.rawHint.join("");
      } else pushText("}}");
    }
  }
  pushText(text.slice(last));
  // unclosed clozes: flatten back to text
  while (stack.length) {
    const top = stack.pop()!;
    const parent = stack.length ? stack[stack.length - 1].node.children : root;
    const idx = parent.indexOf(top.node);
    const literal: ClozeNode[] = [{ t: "text", v: `{{c${top.node.ords.join(",")}::` }, ...top.node.children];
    if (top.rawHint) literal.push({ t: "text", v: "::" + top.rawHint.join("") });
    parent.splice(idx, 1, ...literal);
  }
  return root;
}

export function clozeNumbersInText(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\{\{c([\d,]+)::/g)) for (const n of m[1].split(",")) if (+n > 0) out.add(+n);
  return [...out];
}

function plainText(nodes: ClozeNode[]): string {
  return nodes.map((n) => (n.t === "text" ? n.v : plainText(n.children))).join("");
}

function containsActive(nodes: ClozeNode[], ord: number): boolean {
  return nodes.some((n) => n.t === "cloze" && (n.ords.includes(ord) || containsActive(n.children, ord)));
}

const IO_PREFIX = "image-occlusion:";

function ioShape(content: string, cls: string, ord: number[]): string {
  // image-occlusion:rect:left=.2:top=.3:width=.1:height=.1:oi=1
  const parts = content.slice(IO_PREFIX.length).split(":");
  const shape = parts.shift() ?? "rect";
  const attrs = parts
    .map((p) => {
      const [k, ...v] = p.split("=");
      return k ? ` data-${escapeHtml(k.trim())}="${escapeHtml(v.join("=").trim())}"` : "";
    })
    .join("");
  return `<div class="${cls}" data-shape="${escapeHtml(shape)}" data-ordinal="${ord.join(",")}"${attrs}></div>`;
}

function render(nodes: ClozeNode[], ord: number, question: boolean): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") {
      out += n.v;
      continue;
    }
    const inner = plainText(n.children);
    if (inner.trim().startsWith(IO_PREFIX)) {
      out += ioShape(inner.trim(), n.ords.includes(ord) ? "cloze" : "cloze-inactive", n.ords);
      continue;
    }
    if (n.ords.includes(ord)) {
      if (question) {
        const shown = n.hint ? `[${n.hint}]` : "[...]";
        out += `<span class="cloze" data-cloze="${escapeHtml(render(n.children, ord, false))}" data-ordinal="${n.ords.join(",")}">${shown}</span>`;
      } else {
        out += `<span class="cloze" data-ordinal="${n.ords.join(",")}">${render(n.children, ord, false)}</span>`;
      }
    } else {
      out += `<span class="cloze-inactive" data-ordinal="${n.ords.join(",")}">${render(n.children, ord, question)}</span>`;
    }
  }
  return out;
}

export function renderCloze(text: string, ord: number, question: boolean): string {
  const nodes = parse(text);
  if (!containsActive(nodes, ord)) return render(nodes, ord, question);
  return render(nodes, ord, question);
}

function collectActive(nodes: ClozeNode[], ord: number, out: string[]) {
  for (const n of nodes) {
    if (n.t !== "cloze") continue;
    if (n.ords.includes(ord)) out.push(plainText(n.children));
    else collectActive(n.children, ord, out);
  }
}

/** Text of active clozes, used by {{cloze-only:}} and typing answers. */
export function clozeOnlyText(text: string, ord: number): string {
  const out: string[] = [];
  collectActive(parse(text), ord, out);
  return out.join(", ");
}

export function clozeAnswersForTyping(text: string, ord: number): string {
  const out: string[] = [];
  collectActive(parse(text), ord, out);
  return out.map((s) => stripHtml(s)).join(", ");
}
