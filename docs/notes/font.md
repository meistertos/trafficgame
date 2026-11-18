# Font for the minimal "transit map" design

_Written 2026-11-19 on branch `minimal-design-test`._

## Current state

The Phaser front end (`game/src/config.js`, `FONT`) uses a system font stack and does not ship a font:

```
"Avenir Next", Avenir, Futura, "Helvetica Neue", system-ui, sans-serif
```

- **macOS / iOS:** Avenir Next. This is the look the design was tuned against.
- **Windows:** none of the named fonts are installed by default, so it falls back to `system-ui` (Segoe UI).
- **Android / Linux:** falls back to Roboto, Noto Sans or similar.

So the look changes per platform. Text widths change too, which affects layouts that place items one after another, such as the legend on the level select screen.

## Why this matters for Phaser

Phaser `Text` objects draw onto a canvas when they are created. If a web font is still loading at that moment, Phaser draws the text in the fallback font and does not redraw it later. A self-hosted font therefore has to be loaded **before** any scene creates text.

## Recommendation: self-host a geometric sans

Candidates (all SIL Open Font License, free to bundle):

| Font | Character | Notes |
|---|---|---|
| **Jost** | Closest to Futura/Avenir, geometric, clean | First choice for this style |
| Outfit | Geometric, slightly rounder, friendly | Good for numbers |
| Nunito Sans | Humanist, softer | Less "transit", more readable at small sizes |
| Inter | Neutral UI font | Very legible, less character |

Only two weights are needed: regular (400) and bold (700). Ship them as `woff2`, which is about 20–40 KB per weight if the files are subset to Latin.

## How to wire it in

1. Put the files in `game/public/fonts/` (for example `jost-400.woff2` and `jost-700.woff2`) together with the font's `OFL.txt`.
2. Declare them in `game/index.html`:
   ```css
   @font-face { font-family: "Jost"; src: url("/fonts/jost-400.woff2") format("woff2"); font-weight: 400; font-display: block; }
   @font-face { font-family: "Jost"; src: url("/fonts/jost-700.woff2") format("woff2"); font-weight: 700; font-display: block; }
   ```
3. Before the game starts, wait for both weights in `main.js` (or in `BootScene`):
   ```js
   await Promise.all([document.fonts.load('400 16px Jost'), document.fonts.load('700 16px Jost')]);
   ```
4. Put `Jost` first in `FONT`, and keep the current stack after it as the fallback.

## Open questions

- Do we want the same font everywhere, or is the platform system font acceptable for a prototype?
- Should digits be tabular so the clock does not jitter? Phaser canvas text cannot switch on OpenType features such as `tnum`, so this would need a font whose default figures are tabular (check the chosen font), or a fixed-width layout for the timer.
