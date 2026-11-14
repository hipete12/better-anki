// Minimal protobuf wire-format reader (enough for Anki's stored configs).

export type ProtoValue = number | Uint8Array;

export class ProtoMsg {
  fields = new Map<number, { wire: number; v: ProtoValue }[]>();

  constructor(buf: Uint8Array | null | undefined) {
    if (!buf || !buf.length) return;
    let p = 0;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const varint = (): number => {
      let result = 0;
      let mul = 1;
      for (;;) {
        const b = buf[p++];
        result += (b & 0x7f) * mul;
        if (!(b & 0x80)) break;
        mul *= 128;
        if (p > buf.length) throw new Error("bad varint");
      }
      return result;
    };
    while (p < buf.length) {
      const key = varint();
      const field = Math.floor(key / 8);
      const wire = key & 7;
      let v: ProtoValue;
      if (wire === 0) v = varint();
      else if (wire === 1) {
        v = buf.subarray(p, p + 8);
        p += 8;
      } else if (wire === 2) {
        const len = varint();
        v = buf.subarray(p, p + len);
        p += len;
      } else if (wire === 5) {
        v = view.getFloat32(p, true);
        p += 4;
      } else throw new Error(`unsupported wire type ${wire}`);
      const arr = this.fields.get(field) ?? [];
      arr.push({ wire, v });
      this.fields.set(field, arr);
    }
  }

  has(f: number) {
    return this.fields.has(f);
  }
  num(f: number, def = 0): number {
    const e = this.fields.get(f)?.at(-1);
    if (!e) return def;
    if (typeof e.v === "number") {
      // int64 > 2^63 encoded negative; ids are positive so fine
      return e.v;
    }
    if (e.wire === 1) return new DataView(e.v.buffer, e.v.byteOffset, 8).getFloat64(0, true);
    return def;
  }
  /** signed int (two's complement varint for negative int32/int64) */
  int(f: number, def = 0): number {
    const n = this.num(f, def);
    return n >= 2 ** 63 ? n - 2 ** 64 : n;
  }
  float(f: number, def = 0): number {
    const e = this.fields.get(f)?.at(-1);
    return e && typeof e.v === "number" ? e.v : def;
  }
  bool(f: number): boolean {
    return this.num(f) !== 0;
  }
  bytes(f: number): Uint8Array | undefined {
    const e = this.fields.get(f)?.at(-1);
    return e && e.v instanceof Uint8Array ? e.v : undefined;
  }
  str(f: number, def = ""): string {
    const b = this.bytes(f);
    return b ? new TextDecoder().decode(b) : def;
  }
  msg(f: number): ProtoMsg {
    return new ProtoMsg(this.bytes(f));
  }
  msgs(f: number): ProtoMsg[] {
    return (this.fields.get(f) ?? []).filter((e) => e.v instanceof Uint8Array).map((e) => new ProtoMsg(e.v as Uint8Array));
  }
  /** repeated float, packed or not */
  floats(f: number): number[] {
    const out: number[] = [];
    for (const e of this.fields.get(f) ?? []) {
      if (typeof e.v === "number") out.push(e.v);
      else {
        const dv = new DataView(e.v.buffer, e.v.byteOffset, e.v.byteLength);
        for (let i = 0; i + 4 <= e.v.byteLength; i += 4) out.push(Math.round(dv.getFloat32(i, true) * 1e6) / 1e6);
      }
    }
    return out;
  }
}

// ---------- minimal writer (for exporting media maps) ----------
export class ProtoWriter {
  private parts: number[] = [];
  private varint(n: number) {
    while (n >= 0x80) {
      this.parts.push((n % 128) | 0x80);
      n = Math.floor(n / 128);
    }
    this.parts.push(n);
  }
  uint(f: number, v: number) {
    this.varint(f * 8);
    this.varint(v);
    return this;
  }
  bytes(f: number, b: Uint8Array) {
    this.varint(f * 8 + 2);
    this.varint(b.length);
    for (const x of b) this.parts.push(x);
    return this;
  }
  str(f: number, s: string) {
    return this.bytes(f, new TextEncoder().encode(s));
  }
  finish(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}
