// UI layer: rendering, mouse/touch input, timer, best times.
(function () {
  'use strict';

  const { Game, DIFFICULTIES } = window.Minesweeper;
  const LONG_PRESS_MS = 400;
  const MOVE_TOLERANCE = 10;
  const MIN_CELL = 20; // below this, the board scrolls instead of shrinking
  const MAX_CELL = 40;

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const wrapEl = $('boardWrap');
  const minesEl = $('mines');
  const timerEl = $('timer');
  const faceEl = $('face');
  const statusEl = $('status');
  const diffEl = $('difficulty');
  const modeEl = $('mode');
  const bestEl = $('best');

  let game;
  let cellEls = [];
  const TOUCH_DEVICE = matchMedia('(hover: none)').matches;
  let flagMode = false;
  let hintIdx = null; // open number whose neighbours are highlighted
  let hintTimer = null;
  let timerId = null;
  let startTime = 0;
  let elapsed = 0;

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // On narrow portrait screens, show Expert as 30x16 tall instead of 16x30 wide.
  function boardSize(key) {
    const d = DIFFICULTIES[key];
    const portrait = window.innerWidth < window.innerHeight && window.innerWidth < 700;
    return portrait && d.cols > d.rows ? { rows: d.cols, cols: d.rows, mines: d.mines } : d;
  }

  function newGame() {
    stopTimer();
    elapsed = 0;
    const { rows, cols, mines } = boardSize(diffEl.value);
    game = new Game(rows, cols, mines);
    buildBoard();
    render();
    showBest();
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = `repeat(${game.cols}, var(--cell))`;
    cellEls = game.cells.map((x) => {
      const el = document.createElement('div');
      el.className = 'cell';
      el.dataset.i = x.r * game.cols + x.c;
      el.setAttribute('role', 'gridcell');
      boardEl.appendChild(el);
      return el;
    });
    fitBoard();
  }

  function fitBoard() {
    if (!game) return;
    const avail = Math.min(document.documentElement.clientWidth - 32, 1068);
    let gap = 2;
    let size = Math.floor((avail - gap * (game.cols + 1)) / game.cols);
    if (size < 28) { gap = 1; size = Math.floor((avail - gap * (game.cols + 1)) / game.cols); }
    const root = document.documentElement.style;
    root.setProperty('--gap', gap + 'px');
    root.setProperty('--cell', Math.max(MIN_CELL, Math.min(MAX_CELL, size)) + 'px');
  }

  function render() {
    const over = game.isOver;
    game.cells.forEach((x, i) => {
      const el = cellEls[i];
      let cls = 'cell';
      let txt = '';
      if (x.open) {
        cls += ' open';
        if (x.mine) { txt = '💣'; if (x.exploded) cls += ' exploded'; }
        else if (x.adj) { txt = x.adj; cls += ' n' + x.adj; }
      } else if (x.flag) {
        txt = '🚩';
        if (game.state === 'lost' && !x.mine) { txt = '❌'; cls += ' wrong'; }
      } else if (game.state === 'lost' && x.mine) {
        txt = '💣';
        cls += ' open';
      }
      if (el.className !== cls) el.className = cls;
      if (el.textContent !== String(txt)) el.textContent = txt;
      el.setAttribute('aria-label', x.open ? (x.mine ? 'mine' : String(x.adj || 'empty')) : x.flag ? 'flagged' : 'hidden');
    });

    applyHints();
    minesEl.textContent = pad(game.minesLeft);
    faceEl.textContent = game.state === 'won' ? '😎' : game.state === 'lost' ? '😵' : '🙂';
    statusEl.textContent = game.state === 'won' ? `You won in ${elapsed}s!` : game.state === 'lost' ? 'Boom! Tap 😵 to try again.' : '';
    if (over) stopTimer();
  }

  // ---- neighbour highlight for numbers ----
  function applyHints() {
    for (const el of boardEl.querySelectorAll('.hint, .hint-src')) el.classList.remove('hint', 'hint-src', 'ready');
    if (hintIdx === null || game.isOver) return;
    const x = game.cells[hintIdx];
    if (!x.open || !x.adj) return;
    const around = game.neighbors(x.r, x.c).filter((n) => !n.open);
    const ready = around.filter((n) => n.flag).length === x.adj;
    const src = cellEls[hintIdx];
    src.classList.add('hint-src');
    if (ready) src.classList.add('ready');
    for (const n of around) {
      const el = cellEls[n.r * game.cols + n.c];
      el.classList.add('hint');
      if (ready) el.classList.add('ready');
    }
  }
  function showHint(i) {
    clearTimeout(hintTimer);
    hintIdx = i;
    applyHints();
  }
  function hideHint(delay = 0) {
    clearTimeout(hintTimer);
    const go = () => { hintIdx = null; applyHints(); };
    if (delay) hintTimer = setTimeout(go, delay); else go();
  }

  function pad(n) {
    const s = String(Math.min(999, Math.abs(n))).padStart(3, '0');
    return n < 0 ? '-' + s.slice(1) : s;
  }

  // ---- timer ----
  function startTimer() {
    if (timerId) return;
    startTime = Date.now();
    timerId = setInterval(() => {
      elapsed = Math.floor((Date.now() - startTime) / 1000);
      timerEl.textContent = pad(elapsed);
    }, 250);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    if (game && game.state === 'won') elapsed = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    timerEl.textContent = pad(elapsed);
  }

  // ---- actions ----
  function act(i, flag) {
    if (game.isOver) return;
    const x = game.cells[i];
    const before = game.state;
    if (flag && !x.open) {
      game.toggleFlag(x.r, x.c);
      vibrate(15);
    } else {
      game.reveal(x.r, x.c);
    }
    if (before === 'ready' && game.state !== 'ready') startTimer();
    if (game.state === 'lost') vibrate([60, 40, 120]);
    if (game.state === 'won') { stopTimer(); saveBest(); }
    render();
  }

  function vibrate(p) {
    if (navigator.vibrate) try { navigator.vibrate(p); } catch { /* ignore */ }
  }

  // ---- best times ----
  function bestKey() { return 'minesweeper.best.' + diffEl.value; }
  function saveBest() {
    const prev = Number(storage.get(bestKey())) || Infinity;
    if (elapsed < prev) storage.set(bestKey(), String(elapsed));
    showBest();
  }
  function showBest() {
    const b = storage.get(bestKey());
    bestEl.textContent = b ? `Best ${diffEl.options[diffEl.selectedIndex].text}: ${b}s` : '';
  }

  // ---- input: pointer events cover mouse, touch and pen ----
  let press = null; // { i, x, y, timer, long, el }

  function cellIndex(target) {
    const el = target.closest && target.closest('.cell');
    return el && boardEl.contains(el) ? Number(el.dataset.i) : null;
  }

  function clearPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press.el.classList.remove('pressed');
    press = null;
  }

  boardEl.addEventListener('pointerdown', (e) => {
    const i = cellIndex(e.target);
    if (i === null || game.isOver) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // right-click handled by contextmenu
    clearPress();
    const el = cellEls[i];
    el.classList.add('pressed');
    if (game.cells[i].open && game.cells[i].adj) showHint(i); else hideHint();
    press = { i, x: e.clientX, y: e.clientY, long: false, el, touch: e.pointerType !== 'mouse' };
    if (press.touch) {
      press.timer = setTimeout(() => {
        if (!press) return;
        press.long = true;
        // Long-press does the opposite of the current tap mode.
        act(press.i, !flagMode);
        press.el.classList.remove('pressed');
        if (hintIdx !== null) hideHint(1200);
      }, LONG_PRESS_MS);
    }
  });

  boardEl.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) { clearPress(); hideHint(); }
  });

  boardEl.addEventListener('pointerup', (e) => {
    if (!press) return;
    const { i, long } = press;
    clearPress();
    if (!long && cellIndex(e.target) === i) act(i, flagMode);
    // Keep the highlight briefly so it is visible once the finger lifts.
    if (hintIdx !== null) hideHint(1200);
  });

  boardEl.addEventListener('pointercancel', () => { clearPress(); hideHint(); });
  boardEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') clearPress(); });

  // Right-click flags on desktop; always suppress the menu (and iOS/Android long-press menu).
  boardEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const i = cellIndex(e.target);
    if (i !== null && !press?.touch && e.pointerType !== 'touch' && !matchMedia('(hover: none)').matches) act(i, true);
  });

  // ---- controls ----
  faceEl.addEventListener('click', newGame);
  diffEl.addEventListener('change', () => { storage.set('minesweeper.difficulty', diffEl.value); newGame(); });
  // Tap mode: touch devices default to tap = flag, long-press = dig.
  function setMode(flag) {
    flagMode = flag;
    modeEl.setAttribute('aria-pressed', String(flagMode));
    modeEl.querySelector('.mode-icon').textContent = flagMode ? '🚩' : '⛏️';
    modeEl.querySelector('.mode-label').textContent = flagMode ? 'Tap: Flag' : 'Tap: Dig';
  }
  modeEl.addEventListener('click', () => {
    setMode(!flagMode);
    storage.set('minesweeper.flagMode', flagMode ? '1' : '0');
  });
  const savedMode = storage.get('minesweeper.flagMode');
  setMode(savedMode === null ? TOUCH_DEVICE : savedMode === '1');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2' || (e.key === 'n' && !e.ctrlKey && !e.metaKey && e.target === document.body)) newGame();
  });

  // Re-fit on resize; if orientation flips Expert's shape and no game is in progress, rebuild.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const s = boardSize(diffEl.value);
      if (game.state === 'ready' && (s.rows !== game.rows || s.cols !== game.cols)) newGame();
      else fitBoard();
    }, 150);
  });

  const saved = storage.get('minesweeper.difficulty');
  if (saved && DIFFICULTIES[saved]) diffEl.value = saved;
  newGame();
})();
