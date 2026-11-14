// End-to-end smoke test of the web UI against a running server.
//   bun ui-smoke.mjs <baseUrl> <screenshotDir> <apkgPath>
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

const [base = "http://localhost:8765", out = "./shots", apkg] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const exe = process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};
const step = async (name, fn) => {
  try {
    await fn();
    console.log("ok  ", name);
  } catch (e) {
    console.log("FAIL", name, e.message.split("\n")[0]);
    await page.screenshot({ path: `${out}/FAIL-${name}.png` });
  }
};

await step("connect + create account", async () => {
  await page.goto(base);
  await page.getByText("Create your account").waitFor();
  await shot("01-setup");
  await page.getByLabel("Username").fill("peter");
  await page.locator('input[type=password]').nth(0).fill("correct horse battery");
  await page.locator('input[type=password]').nth(1).fill("correct horse battery");
  await page.getByRole("button", { name: /Create account/ }).click();
  await page.getByRole("heading", { name: "Decks" }).waitFor();
  await shot("02-decks-empty");
});

if (apkg)
  await step("import apkg", async () => {
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator('input[type=file]').setInputFiles(apkg);
    await shot("03-import-dialog");
    await page.getByRole("dialog").getByRole("button", { name: "Import" }).click();
    await page.getByText("Import complete").waitFor();
    await shot("04-import-done");
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByText("Spanish").first().waitFor();
    await shot("05-decks");
  });

await step("study", async () => {
  await page.getByRole("link", { name: "Languages" }).click();
  await page.getByRole("button", { name: /Study now|Open/ }).click();
  await page.getByRole("button", { name: /Show answer/ }).waitFor();
  await page.waitForTimeout(600);
  await shot("06-study-question");
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: /Good/ }).waitFor();
  await shot("07-study-answer");
  await page.keyboard.press("3");
  await page.waitForTimeout(500);
  await page.keyboard.press("Space");
  await page.keyboard.press("1");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await page.waitForTimeout(500);
  await shot("08-study-after-undo");
  await page.getByRole("button", { name: "More" }).click();
  await shot("09-study-menu");
  await page.keyboard.press("Escape");
});

await step("science deck with image, audio and cloze", async () => {
  await page.goto(base + "/");
  await page.getByRole("link", { name: "Science" }).click();
  await page.getByRole("button", { name: /Study now|Open/ }).click();
  await page.getByRole("button", { name: /Show answer/ }).waitFor();
  await page.waitForTimeout(800);
  await shot("10-science-question");
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);
  await shot("11-science-answer");
});

await step("add note", async () => {
  await page.goto(base + "/add");
  await page.getByRole("heading", { name: "Add" }).waitFor();
  const editors = page.locator(".field-editor");
  await editors.nth(0).click();
  await page.keyboard.type("¿Dónde está la biblioteca?");
  await editors.nth(1).click();
  await page.keyboard.type("Where is the library?");
  await shot("12-add");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.waitForTimeout(800);
  await shot("13-add-preview");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText(/Added 1 card/).waitFor();
});

await step("browse", async () => {
  await page.goto(base + "/browse?q=");
  await page.locator("tbody tr").first().waitFor();
  await page.locator("tbody tr").nth(1).click();
  await page.waitForTimeout(800);
  await shot("14-browse");
  await page.locator("#browse-search").fill("tag:spanish is:new");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  await shot("15-browse-search");
});

await step("stats", async () => {
  await page.goto(base + "/stats");
  await page.getByText("Calendar").waitFor();
  await page.waitForTimeout(600);
  await shot("16-stats");
  await page.mouse.wheel(0, 900);
  await shot("17-stats-2");
});

await step("deck options", async () => {
  await page.goto(base + "/");
  await page.getByRole("link", { name: "Science" }).click();
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByText("Daily limits").waitFor();
  await shot("18-options");
});

await step("note types + template editor", async () => {
  await page.goto(base + "/notetypes");
  await page.getByText("Basic (and reversed card)").waitFor();
  await shot("19-notetypes");
  await page.getByRole("button", { name: "Cards" }).first().click();
  await page.waitForTimeout(1200);
  await shot("20-template-editor");
  await page.keyboard.press("Escape");
});

await step("settings", async () => {
  await page.goto(base + "/settings");
  await page.getByText("Security & encryption").waitFor();
  await page.waitForTimeout(500);
  await shot("21-settings");
});

await step("dark mode", async () => {
  await page.evaluate(() => {
    localStorage.setItem("ba.theme", "dark");
    document.documentElement.classList.add("dark");
  });
  await page.goto(base + "/");
  await page.waitForTimeout(500);
  await shot("22-dark-decks");
  await page.getByRole("link", { name: "Science" }).click();
  await page.getByRole("button", { name: /Study now|Open/ }).click();
  await page.getByRole("button", { name: /Show answer/ }).waitFor();
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);
  await shot("23-dark-study");
  await page.goto(base + "/stats");
  await page.getByText("Calendar").waitFor();
  await page.waitForTimeout(500);
  await shot("24-dark-stats");
});

await step("mobile", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/");
  await page.waitForTimeout(500);
  await shot("25-mobile-decks");
  await page.getByRole("link", { name: "Spanish" }).click();
  await page.getByRole("button", { name: /Study now|Open/ }).click();
  await page.getByRole("button", { name: /Show answer/ }).waitFor();
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  await shot("26-mobile-study");
});

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
