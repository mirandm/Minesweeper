# Minesweeper

A dependency-free browser Minesweeper that works on desktop and mobile.

## Play
Open `index.html` in any browser (no build step), or host the folder on GitHub Pages.

- **Desktop:** click to open, right-click to flag, click a number to open its neighbours when its flags are placed. `F2` or `N` starts a new game.
- **Mobile:** tap to flag, long-press to open (with haptic feedback). Touch a number to highlight the squares it covers (green = enough flags, tap to open the rest). The 🚩/⛏️ button swaps tap and long-press; the choice is remembered.
- **💡 Hint:** shows the next certain move (green = open, red = flag), outlines the numbers that prove it (blue and pink for overlapping pairs, with their shared squares dashed) and explains the reasoning in words. It also catches flags placed on safe squares. Games won with hints don't set best times.
- Difficulties: Beginner 9×9/10, Intermediate 16×16/40, Expert 30×16/99 (shown tall on portrait phones).
- **No guessing:** start anywhere (the first tap always opens an area, whatever the tap mode). The board is then generated so a built-in logic solver can clear it from that square, so the whole game needs deduction only, never a 50/50 guess. Best times are saved per difficulty in the browser.

## Files
- `game.js` – game logic, no DOM (unit-tested)
- `solver.js` – no-guess board generator and logic solver
- `app.js` – rendering and mouse/touch input
- `index.html`, `style.css` – layout, responsive board sizing

## Test
```
node --test
```

## Install on iPhone / Android
The page is an installable web app (manifest, icons, offline service worker). It must be served over HTTPS, e.g. GitHub Pages:

1. Repo **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)` → Save.
2. On the iPhone, open `https://<user>.github.io/Minesweeper/` in **Safari**.
3. Tap **Share → Add to Home Screen**.

It then launches full-screen with its own icon and works offline. After changing files, bump `CACHE` in `sw.js` so devices pick up the update.
