# Minesweeper

A dependency-free browser Minesweeper that works on desktop and mobile.

## Play
Open `index.html` in any browser (no build step), or host the folder on GitHub Pages.

- **Desktop:** click to open, right-click to flag, click a number to open its neighbours when its flags are placed. `F2` or `N` starts a new game.
- **Mobile:** tap to open, long-press to flag (with haptic feedback), or use the ⛏️/🚩 toggle to make taps place flags.
- Difficulties: Beginner 9×9/10, Intermediate 16×16/40, Expert 30×16/99 (shown tall on portrait phones).
- First click is always safe and opens an area. Best times are saved per difficulty in the browser.

## Files
- `game.js` – game logic, no DOM (unit-tested)
- `app.js` – rendering and mouse/touch input
- `index.html`, `style.css` – layout, responsive board sizing

## Test
```
node --test
```
