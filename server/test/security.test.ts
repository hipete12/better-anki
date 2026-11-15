import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection } from "../src/collection";
import { randomKey, seal, open } from "../src/crypto/aead";
import { KeyManager } from "../src/crypto/auth";
import { createServer } from "../src/index";
import { importApkg } from "../src/importer/apkg";

const j = async (r: Promise<Response>, text = false): Promise<any> => (text ? (await r).text() : (await r).json());
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ba-sec-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function grepDir(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (readFileSync(p).includes(Buffer.from(needle))) hits.push(p);
    }
  };
  walk(dir);
  return hits;
}

describe("encryption at rest", () => {
  test("AEAD rejects tampering and wrong keys", () => {
    const k = randomKey();
    const blob = seal(k, new TextEncoder().encode("secret"), "ctx");
    expect(new TextDecoder().decode(open(k, blob, "ctx"))).toBe("secret");
    expect(() => open(randomKey(), blob, "ctx")).toThrow();
    expect(() => open(k, blob, "other")).toThrow();
    blob[blob.length - 1] ^= 1;
    expect(() => open(k, blob, "ctx")).toThrow();
  });

  test("no plaintext note content, media or filenames on disk", () => {
    const dir = tmp();
    const key = randomKey();
    const col = new Collection(dir, key, { autoFlush: false });
    importApkg(col, new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", "modern.apkg"))));
    col.addNote(col.notetypeByName("Basic")!.id, ["SuperSecretFrontText", "TopSecretBack"], ["classified"], 1);
    col.close();
    for (const needle of ["SuperSecretFrontText", "TopSecretBack", "classified", "Canberra", "red square", "beep.mp3", "fake-mp3", "SQLite format"]) {
      expect(grepDir(dir, needle)).toEqual([]);
    }
    // reopen with the right key works, wrong key fails
    const again = new Collection(dir, key, { autoFlush: false });
    expect(again.counts().notes).toBe(9);
    expect(again.media.read("beep.mp3")).toBeTruthy();
    again.close();
    expect(() => new Collection(dir, randomKey(), { autoFlush: false })).toThrow();
  });
});

describe("key custody", () => {
  test("password and device tokens unwrap the data key; restart starts locked", () => {
    const dir = tmp();
    const km = new KeyManager(dir);
    let unlocked: Uint8Array | null = null;
    km.onUnlock = (k) => (unlocked = k);
    expect(km.setupRequired).toBe(true);
    expect(() => km.setup("me", "pw", "test", "1.2.3.4", null, true)).toThrow(); // too short
    expect(() => km.setup("me", "longpassword", "test", "1.2.3.4", "WRONG", false)).toThrow(); // remote needs code
    const token = km.setup("me", "longpassword", "laptop", "127.0.0.1", null, true);
    const dek1 = unlocked!;
    expect(km.locked).toBe(false);
    const authJson = readFileSync(join(dir, "auth.json"), "utf8");
    expect(authJson).not.toContain(token);
    expect(authJson).not.toContain("laptop");
    expect(authJson).not.toContain('"me"');

    // simulate restart
    const km2 = new KeyManager(dir);
    let dek2: Uint8Array | null = null;
    km2.onUnlock = (k) => (dek2 = k);
    expect(km2.locked).toBe(true);
    expect(() => km2.authenticate("bogus", "1.1.1.1")).toThrow();
    km2.authenticate(token, "1.1.1.1");
    expect(Buffer.from(dek2!).equals(Buffer.from(dek1))).toBe(true);

    const km3 = new KeyManager(dir);
    let dek3: Uint8Array | null = null;
    km3.onUnlock = (k) => (dek3 = k);
    expect(() => km3.login("me", "wrongpassword", "x", "9.9.9.9")).toThrow();
    km3.login("ME", "longpassword", "phone", "9.9.9.9");
    expect(Buffer.from(dek3!).equals(Buffer.from(dek1))).toBe(true);
    expect(km3.sessions().map((s) => s.device).sort()).toEqual(["laptop", "phone"]);

    // revoked tokens stop working; password change keeps the same data key
    const sid = km3.sessions().find((s) => s.device === "laptop")!.id;
    km3.revoke(sid);
    expect(() => km3.authenticate(token, "1.1.1.1")).toThrow();
    km3.changePassword("longpassword", "evenlongerpassword");
    const km4 = new KeyManager(dir);
    let dek4: Uint8Array | null = null;
    km4.onUnlock = (k) => (dek4 = k);
    km4.login("me", "evenlongerpassword", "tablet", "1.1.1.1");
    expect(Buffer.from(dek4!).equals(Buffer.from(dek1))).toBe(true);
  });

  test("brute force is rate limited", () => {
    const km = new KeyManager(tmp());
    km.setup("me", "longpassword", "x", "127.0.0.1", null, true);
    for (let i = 0; i < 5; i++) expect(() => km.login("me", "nope-nope", "x", "6.6.6.6")).toThrow();
    expect(() => km.login("me", "longpassword", "x", "6.6.6.6")).toThrow(/Too many/);
  });

  test("signed media tokens", () => {
    const km = new KeyManager(tmp());
    km.setup("me", "longpassword", "x", "127.0.0.1", null, true);
    const sid = km.sessions()[0].id;
    const t = km.mediaToken(sid);
    expect(km.verifyMediaToken(t)).toBe(true);
    expect(km.verifyMediaToken(t.slice(0, -2) + "xx")).toBe(false);
    km.revoke(sid);
    expect(km.verifyMediaToken(t)).toBe(false);
  });
});

describe("HTTP API", () => {
  test("setup, auth, locked restart, media", async () => {
    const dir = tmp();
    const srv = createServer({ data: dir, port: 0, host: "127.0.0.1", web: null, quiet: true });
    const base = `http://127.0.0.1:${srv.server.port}`;
    const health = await j(fetch(`${base}/api/health`));
    expect(health.setupRequired).toBe(true);
    expect((await fetch(`${base}/api/decks`)).status).toBe(401);
    const setup = await j(fetch(`${base}/api/auth/setup`, { method: "POST", body: JSON.stringify({ username: "me", password: "longpassword", device: "test" }) }));
    const auth = { authorization: `Bearer ${setup.token}` };
    const decks = await j(fetch(`${base}/api/decks`, { headers: auth }));
    expect(decks.tree).toBeTruthy();
    // add note with media and render it through a signed media URL
    const up = await j(fetch(`${base}/api/media`, { method: "POST", headers: auth, body: JSON.stringify({ name: "x.png", data: btoa("PNGDATA") }) }));
    const nts = await j(fetch(`${base}/api/notetypes`, { headers: auth }));
    const basic = nts.find((n: any) => n.name === "Basic");
    await fetch(`${base}/api/notes`, { method: "POST", headers: auth, body: JSON.stringify({ notetypeId: basic.id, deckId: 1, fields: [`<img src="${up.filename}">`, "b"] }) });
    const study = await j(fetch(`${base}/api/study/1`, { headers: auth }));
    const m = /<base href="([^"]+)"/.exec(study.card.question)!;
    expect(m[1]).toContain("/media/");
    expect(m[1]).not.toContain(setup.token);
    expect(await j(fetch(m[1] + up.filename), true)).toBe("PNGDATA");
    expect((await fetch(m[1].replace(/media\/[^/]+/, "media/forged") + up.filename)).status).toBe(401);
    // live change events require auth and deliver changes
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
    const ev = await fetch(`${base}/api/events`, { headers: auth });
    const reader = ev.body!.getReader();
    await reader.read(); // hello
    await fetch(`${base}/api/decks`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Live" }) });
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain("event: change");
    expect(chunk).toContain("decks");
    await reader.cancel();
    // browse: "#" is the position in the deck's original order, and sorts by it
    for (const f of ["second", "third"]) await fetch(`${base}/api/notes`, { method: "POST", headers: auth, body: JSON.stringify({ notetypeId: basic.id, deckId: 1, fields: [f, "b"] }) });
    const br = await j(fetch(`${base}/api/browse?q=&sort=order&desc=1`, { headers: auth }));
    expect(br.rows.map((r: { order: number }) => r.order)).toEqual([3, 2, 1]);
    expect(br.rows[0].sortField).toBe("third");
    expect(br.rows[0].state).toBe("new");
    expect(br.rows[0].layout).toBe("Default");
    expect((await j(fetch(`${base}/api/browse?q=&sort=layout`, { headers: auth }))).rows).toHaveLength(3);
    expect(await j(fetch(`${base}/api/layouts`, { headers: auth }))).toEqual([]);
    srv.stop();

    // restart: locked until the device token is presented
    const srv2 = createServer({ data: dir, port: 0, host: "127.0.0.1", web: null, quiet: true });
    const base2 = `http://127.0.0.1:${srv2.server.port}`;
    expect((await j(fetch(`${base2}/api/health`))).locked).toBe(true);
    const d2 = await j(fetch(`${base2}/api/decks`, { headers: auth }));
    expect(d2.tree.length).toBeGreaterThan(0);
    expect((await j(fetch(`${base2}/api/health`))).locked).toBe(false);
    srv2.stop();
  });
});
