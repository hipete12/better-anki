// Screenshot tour of the web UI for design review (signs in to an existing account).
//   bun shots.mjs <baseUrl> <outDir> <username> <password> [pages...]
// pages: home deck study answer done stats settings add browse options notetypes connect (default: all)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

const [base, out, user, pass, ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const want = (p) => !only.length || only.includes(p);
const errors = [];

async function session(name, viewport, dark) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  await page.goto(base);
  if (want("connect")) {
    await page.getByLabel("Username").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-connect.png` });
  }
  await page.getByLabel("Username").fill(user);
  await page.locator("input[type=password]").first().fill(pass);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.waitForURL((u) => !u.pathname.includes("connect"));
  await page.waitForTimeout(800);
  return { ctx, page };
}

async function tour(name, viewport, dark) {
  const { ctx, page } = await session(name, viewport, dark);
  const shot = async (p) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${name}-${p}.png`, fullPage: !["study", "answer", "science"].includes(p) });
    console.log("shot", name, p);
  };
  if (want("home")) {
    await page.goto(base + "/");
    await shot("home");
  }
  // find a deck link
  const deckHref = await page.locator('a[href^="/deck/"]').nth(1).getAttribute("href").catch(() => null);
  if (deckHref && want("deck")) {
    await page.goto(base + deckHref);
    await shot("deck");
  }
  if (deckHref && (want("study") || want("answer"))) {
    await page.goto(base + deckHref.replace("/deck/", "/study/"));
    await page.waitForTimeout(900);
    await shot("study");
    await page.keyboard.press("Space");
    await shot("answer");
  }
  if (want("science")) {
    await page.goto(base + "/");
    const sci = await page.getByRole("link", { name: "Science" }).getAttribute("href").catch(() => null);
    if (sci) {
      await page.goto(base + sci.replace("/deck/", "/study/"));
      await page.waitForTimeout(900);
      await page.keyboard.press("Space");
      await shot("science");
    }
  }
  for (const [p, path] of [
    ["stats", "/stats"],
    ["settings", "/settings"],
    ["add", "/add"],
    ["browse", "/browse?q="],
    ["notetypes", "/notetypes"],
  ]) {
    if (!want(p)) continue;
    await page.goto(base + path);
    await shot(p);
  }
  if (deckHref && want("options")) {
    await page.goto(base + deckHref.replace("/deck/", "/options/"));
    await shot("options");
  }
  await ctx.close();
}

await tour("desk", { width: 1360, height: 860 }, false);
await tour("dark", { width: 1360, height: 860 }, true);
await tour("mob", { width: 390, height: 844 }, false);
console.log(errors.length ? "console errors:\n" + errors.join("\n") : "console errors: none");
await browser.close();
