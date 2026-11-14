// Credentials at rest in the browser are encrypted with a non-extractable
// AES-GCM key kept in IndexedDB (WebCrypto). Script running in this origin can
// still use the key, but the raw token never sits in localStorage in the clear
// and the key itself can't be exported or copied to another machine.
// WebCrypto needs a secure context (https:// or localhost); elsewhere we fall
// back to session-only storage so nothing persists unencrypted.

export interface Credentials {
  server: string;
  token: string;
  username: string | null;
}

const STORE_KEY = "ba.creds.v1";
const DB = "better-anki-keys";

export const secureContextAvailable = () => typeof crypto !== "undefined" && !!crypto.subtle && typeof indexedDB !== "undefined" && window.isSecureContext;

function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode = "readonly"): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction("keys", mode);
      const r = fn(tx.objectStore("keys"));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    };
  });
}

async function deviceKey(): Promise<CryptoKey> {
  const existing = await idb<CryptoKey | undefined>((s) => s.get("device") as IDBRequest<CryptoKey | undefined>);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idb((s) => s.put(key, "device"), "readwrite");
  return key;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function saveCredentials(c: Credentials): Promise<void> {
  const json = JSON.stringify(c);
  if (secureContextAvailable()) {
    const key = await deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(STORE_KEY) }, key, new TextEncoder().encode(json)));
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) }));
    sessionStorage.removeItem(STORE_KEY);
  } else {
    sessionStorage.setItem(STORE_KEY, json);
  }
}

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw && secureContextAvailable()) {
      const { iv, ct } = JSON.parse(raw);
      const key = await deviceKey();
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(STORE_KEY) }, key, unb64(ct));
      return JSON.parse(new TextDecoder().decode(pt));
    }
    const s = sessionStorage.getItem(STORE_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  localStorage.removeItem(STORE_KEY);
  sessionStorage.removeItem(STORE_KEY);
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? " on " + os : ""} (web)`;
}
