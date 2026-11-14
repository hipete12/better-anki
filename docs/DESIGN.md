# Design language

Simple, modern and efficient. The UI is a calm frame around the cards. Hierarchy comes from type size, weight and **colored numbers**, not from decoration. The web and Android apps share these rules.

## Rules

1. **No filler.** Don't add sections, tiles or charts just to occupy space. Empty space is fine.
2. **Numbers carry meaning through color**, not through boxes or icons. A stat is a number with a small muted label under it.
3. **Few icons.** Use icons for navigation, compact toolbar actions (back, undo, more) and menus. Labels, settings rows and stats are text.
4. **One accent.** Indigo marks primary actions and the current selection. There are no gradients, glows, illustrations or decorative animation.
5. **Flat surfaces.** Use 1 px borders on white (light) or near-black (dark), with radius 8–12. Shadows only on floating layers (menus, dialogs, toasts).
6. **Accessible.** Never rely on color alone: every colored number has a label. Use tabular numbers, keep AA contrast in both themes, and respect `prefers-reduced-motion`.

## Tokens

| | Light | Dark |
|---|---|---|
| Background / surface | `#f7f7f8` / `#ffffff` | `#0f1013` / `#16171b` |
| Border | `#e5e6ea` | `#2a2c33` |
| Text / muted / faint | `#16171c` / `#61646f` / `#9a9da8` | `#ececf0` / `#9a9ca8` / `#6b6e7a` |
| Accent | `#4f46e5` | `#818cf8` |
| New · Learning · Due (Anki convention) | `#2563eb` · `#dc2626` · `#16a34a` | `#60a5fa` · `#f87171` · `#4ade80` |
| Again · Hard · Good · Easy | `#dc2626` · `#b45309` · `#15803d` · `#2563eb` | `#f87171` · `#fbbf24` · `#4ade80` · `#60a5fa` |
| Streak | `#ea580c` | `#fb923c` |

- **Type.** Inter (bundled with the web app, so there are no font requests) and the system font on Android. Body text is 14 px, page titles 24–28 px semibold with slight negative tracking, and stat numbers 22–36 px semibold.
- **Charts.** The validated data-viz palette in `web/src/index.css` (`--series-*`, `--seq-*`).

## Patterns

- **Stat row.** A row of 3–5 numbers (e.g. *9 due today · 10 studied · 90% correct · 1d streak*), colored only when the color means something. It sits above the content it summarizes, without a container.
- **Card-state trend.** The Decks page opens with one line chart of learning, young and mature cards per day over the last 90 days (new cards left out). The legend carries today's counts, line ends are labeled when they don't collide, hover shows a crosshair tooltip, and a toggle shows the data as a table. It's hidden until something has been studied.
- **Deck list.** One bordered list. Each row has the name, a faint card total and the new/learn/due counts in their state colors (zeros faint). Actions live in a `⋯` menu.
- **Study.** The top bar shows back, the deck name, the three counts (current queue underlined), undo and a menu, with a 2 px progress line below. The card sits on a bordered sheet. The four rating buttons have a colored label and a muted interval. Card zoom is Ctrl +/−.
- **Completion.** A title, one line of explanation, three numbers and the next action.
- **Settings.** Grouped cards with plain text rows. Status uses small colored dots, not icons.
