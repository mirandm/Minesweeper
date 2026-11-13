// Logic engine shared by the no-guess board generator and the hint feature.
// It only makes deductions a careful human could make, one step at a time:
//   1. single number    – a number's remaining squares are all safe or all mines
//   2. pair of numbers  – overlapping numbers (the classic 1-2 / 1-1 patterns)
//   3. mine count       – all mines found, or every hidden square is a mine
//   4. small regions    – every possible layout of a few squares agrees
// Boards the engine cannot finish are discarded, so every accepted board can be
// cleared without guessing, and a hint is always available on them.
(function (root) {
  'use strict';

  const neighborCache = new Map();
  function neighborTable(rows, cols) {
    const key = rows + 'x' + cols;
    if (!neighborCache.has(key)) {
      const table = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const list = [];
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr, cc = c + dc;
              if ((dr || dc) && rr >= 0 && rr < rows && cc >= 0 && cc < cols) list.push(rr * cols + cc);
            }
          }
          table.push(list);
        }
      }
      neighborCache.set(key, table);
    }
    return neighborCache.get(key);
  }

  // Exhaustive search only for small regions, so required deductions stay human-sized.
  const ENUM_MAX_CELLS = 10;
  const ENUM_MAX_NODES = 100000;

  // ---------------------------------------------------------------------------
  // Deduction engine
  // ctx: { n, nb, adj, open, mine, safe, totalMines }
  //   open[i]  – square is revealed (adj[i] is its number)
  //   mine[i]  – square is a proven mine
  //   safe[i]  – square is proven safe but not yet revealed
  // ---------------------------------------------------------------------------

  // Each revealed number gives a constraint: its unresolved neighbours hold exactly m mines.
  function buildConstraints(ctx) {
    const { n, nb, adj, open, mine, safe } = ctx;
    const list = [];
    for (let i = 0; i < n; i++) {
      if (!open[i] || adj[i] === 0) continue;
      const cells = [];
      let flagged = 0;
      for (const j of nb[i]) {
        if (mine[j]) flagged++;
        else if (!open[j] && !safe[j]) cells.push(j);
      }
      if (cells.length) list.push({ src: i, num: adj[i], flagged, m: adj[i] - flagged, cells });
    }
    return list;
  }

  // Returns the simplest next deduction, or null if only a guess is left.
  // Result: { rule, cons, safe: [cells], mines: [cells], ... }
  function nextDeduction(ctx) {
    const cons = buildConstraints(ctx);

    // 1. Single number.
    for (const k of cons) {
      if (k.m === 0) return { rule: 'single', cons: [k], safe: k.cells, mines: [] };
      if (k.m === k.cells.length) return { rule: 'single', cons: [k], safe: [], mines: k.cells };
    }

    // 2. Pairs of overlapping numbers. X's squares outside Y are all mines when
    //    X needs exactly that many more mines than Y can supply; Y's own squares are then safe.
    const byCell = new Map();
    cons.forEach((k, idx) => k.cells.forEach((c) => {
      if (!byCell.has(c)) byCell.set(c, []);
      byCell.get(c).push(idx);
    }));
    for (let a = 0; a < cons.length; a++) {
      const A = cons[a];
      const setA = new Set(A.cells);
      const partners = new Set();
      for (const c of A.cells) for (const b of byCell.get(c)) if (b > a) partners.add(b);
      for (const b of partners) {
        const B = cons[b];
        const setB = new Set(B.cells);
        const onlyA = A.cells.filter((c) => !setB.has(c));
        const onlyB = B.cells.filter((c) => !setA.has(c));
        if (!onlyA.length && !onlyB.length) continue;
        if (A.m - B.m === onlyA.length) return { rule: 'pair', cons: [A, B], mines: onlyA, safe: onlyB };
        if (B.m - A.m === onlyB.length) return { rule: 'pair', cons: [B, A], mines: onlyB, safe: onlyA };
      }
    }

    // 3. Mine count.
    const { n, open, mine, safe, totalMines } = ctx;
    let known = 0;
    const unknown = [];
    for (let i = 0; i < n; i++) {
      if (mine[i]) known++;
      else if (!open[i] && !safe[i]) unknown.push(i);
    }
    const remaining = totalMines - known;
    if (unknown.length && remaining === 0) return { rule: 'count-safe', cons: [], safe: unknown, mines: [], known };
    if (unknown.length && remaining === unknown.length) return { rule: 'count-mines', cons: [], safe: [], mines: unknown, remaining };

    // 4. Small regions: try every layout.
    const regions = buildRegions(cons, byCell);
    const frontier = regions.reduce((s, r) => s + r.cells.length, 0);
    // With a single region and nothing hidden elsewhere, the mine counter pins the total.
    const exact = regions.length === 1 && unknown.length === frontier ? remaining : -1;
    for (const reg of regions) {
      if (reg.cells.length > ENUM_MAX_CELLS) continue;
      const res = enumerateRegion(reg, exact, remaining);
      if (!res) continue;
      const safeCells = reg.cells.filter((c, i) => res.mineCount[i] === 0);
      const mineCells = reg.cells.filter((c, i) => res.mineCount[i] === res.solutions);
      if (safeCells.length || mineCells.length) {
        return { rule: 'region', cons: reg.cons, safe: safeCells, mines: mineCells, solutions: res.solutions, usedCount: exact >= 0, remaining };
      }
    }
    return null;
  }

  // Split frontier squares into independent groups linked by shared numbers.
  function buildRegions(cons, byCell) {
    const seen = new Set();
    const regions = [];
    for (const first of byCell.keys()) {
      if (seen.has(first)) continue;
      const cells = [];
      const kIdx = new Set();
      const queue = [first];
      seen.add(first);
      while (queue.length) {
        const c = queue.pop();
        cells.push(c);
        for (const k of byCell.get(c)) {
          if (kIdx.has(k)) continue;
          kIdx.add(k);
          for (const d of cons[k].cells) if (!seen.has(d)) { seen.add(d); queue.push(d); }
        }
      }
      regions.push({ cells, cons: [...kIdx].map((k) => cons[k]) });
    }
    return regions;
  }

  function enumerateRegion(reg, exact, maxMines) {
    const cells = reg.cells;
    const pos = new Map(cells.map((c, i) => [c, i]));
    const cs = reg.cons.map((k) => ({ idx: k.cells.map((c) => pos.get(c)), m: k.m }));
    const cellCons = cells.map(() => []);
    cs.forEach((k, ki) => k.idx.forEach((i) => cellCons[i].push(ki)));
    const assigned = new Int8Array(cells.length).fill(-1);
    const placed = new Int32Array(cs.length);
    const free = cs.map((k) => k.idx.length);
    const mineCount = new Int32Array(cells.length);
    let solutions = 0, nodes = 0, total = 0, aborted = false;

    const ok = (i) => cellCons[i].every((k) => placed[k] <= cs[k].m && placed[k] + free[k] >= cs[k].m);
    function rec(i) {
      if (aborted) return;
      if (++nodes > ENUM_MAX_NODES) { aborted = true; return; }
      if (i === cells.length) {
        if (exact >= 0 && total !== exact) return;
        solutions++;
        for (let j = 0; j < cells.length; j++) if (assigned[j]) mineCount[j]++;
        return;
      }
      for (const v of [0, 1]) {
        if (v && total >= maxMines) continue;
        assigned[i] = v;
        total += v;
        for (const k of cellCons[i]) { free[k]--; placed[k] += v; }
        if (ok(i)) rec(i + 1);
        for (const k of cellCons[i]) { free[k]++; placed[k] -= v; }
        total -= v;
        assigned[i] = -1;
      }
    }
    rec(0);
    if (aborted || solutions === 0) return null;
    return { solutions, mineCount };
  }

  // ---------------------------------------------------------------------------
  // Solver: plays a full board from `start` using only the engine's deductions.
  // ---------------------------------------------------------------------------
  function solve(rows, cols, mines, start) {
    const n = rows * cols;
    const nb = neighborTable(rows, cols);
    const adj = new Uint8Array(n);
    let totalMines = 0;
    for (let i = 0; i < n; i++) {
      if (mines[i]) totalMines++;
      for (const j of nb[i]) if (mines[j]) adj[i]++;
    }
    const ctx = { n, nb, adj, open: new Uint8Array(n), mine: new Uint8Array(n), safe: new Uint8Array(n), totalMines };
    let opened = 0;
    const safeTotal = n - totalMines;

    function reveal(i) {
      const stack = [i];
      while (stack.length) {
        const x = stack.pop();
        if (ctx.open[x] || ctx.mine[x]) continue;
        if (mines[x]) throw new Error('solver opened a mine'); // would mean an unsound deduction
        ctx.open[x] = 1;
        opened++;
        if (adj[x] === 0) for (const y of nb[x]) if (!ctx.open[y]) stack.push(y);
      }
    }

    reveal(start);
    while (opened < safeTotal) {
      const d = nextDeduction(ctx);
      if (!d) return false; // stuck: the next move would be a guess
      for (const c of d.safe) reveal(c);
      for (const c of d.mines) ctx.mine[c] = 1;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Hint: the simplest certain move from what the player can see.
  // view: { open[], adj[] (numbers of open squares), flag[] (player flags) }
  // Player flags are not trusted; a mine counts as known only once it is proven
  // (and flagged), so explanations never rely on hidden information.
  // ---------------------------------------------------------------------------
  function hint(rows, cols, totalMines, view) {
    const n = rows * cols;
    const nb = neighborTable(rows, cols);
    const ctx = {
      n, nb, totalMines,
      adj: Uint8Array.from(view.adj),
      open: Uint8Array.from(view.open),
      mine: new Uint8Array(n),
      safe: new Uint8Array(n),
    };
    for (let guard = 0; guard < n * 2; guard++) {
      const d = nextDeduction(ctx);
      if (!d) {
        return { rule: 'none', safe: [], mines: [], numbers: [], wrongFlags: [],
          text: 'There is no certain move from here. Any next step would be a guess.' };
      }
      const toFlag = d.mines.filter((c) => !view.flag[c]);
      if (d.safe.length || toFlag.length) return describe(d, view, toFlag);
      // The player already flagged these proven mines: accept them and keep looking.
      for (const c of d.mines) ctx.mine[c] = 1;
    }
    return { rule: 'none', safe: [], mines: [], numbers: [], wrongFlags: [], text: 'No hint available.' };
  }

  const plural = (k, one, many) => (k === 1 ? one : many);
  const mines = (k) => `${k} ${plural(k, 'mine', 'mines')}`;
  const squares = (k) => `${k} hidden ${plural(k, 'square', 'squares')}`;
  // "other hidden square" / "other 3 hidden squares"
  const other = (k) => (k === 1 ? 'other hidden square' : `other ${k} hidden squares`);
  // "needs 2 mines" or "still needs 1 more mine" when some are already flagged
  const needs = (k) => (k.flagged ? `still needs ${k.m} more ${plural(k.m, 'mine', 'mines')}` : `needs ${mines(k.m)}`);

  function describe(d, view, toFlag) {
    const wrongFlags = d.safe.filter((c) => view.flag[c]);
    let numbers = d.cons.map((k) => ({ cell: k.src, label: '' }));
    let shared = [];
    let text = '';

    if (d.rule === 'single') {
      const k = d.cons[0];
      if (d.safe.length) {
        text = `This ${k.num} already has ${k.flagged === 1 ? 'its mine' : `all ${k.flagged} of its mines`} flagged, ` +
          `so the ${other(d.safe.length)} next to it ${plural(d.safe.length, 'is', 'are')} safe.`;
      } else if (k.flagged === 0) {
        text = k.num === 1
          ? 'This 1 has only one hidden square next to it, so that square is the mine.'
          : `This ${k.num} has exactly ${k.num} hidden squares around it, so all of them are mines.`;
      } else {
        text = `This ${k.num} already touches ${k.flagged} flagged ${plural(k.flagged, 'mine', 'mines')} and ${needs(k)}. ` +
          `It has exactly ${squares(k.m)} left, so ${plural(k.m, 'that square is a mine', 'they are all mines')}.`;
      }
    } else if (d.rule === 'pair') {
      // A is outlined blue, B pink in the UI.
      const [X, Y] = d.cons;
      numbers = [{ cell: X.src, label: 'A' }, { cell: Y.src, label: 'B' }];
      const inY = new Set(Y.cells);
      shared = X.cells.filter((c) => inY.has(c));
      const A = `blue ${X.num}`, B = `pink ${Y.num}`;
      if (d.mines.length) {
        text = `The ${A} ${needs(X)}. The squares it shares with the ${B} (dashed) can hold at most ${mines(Y.m)}, ` +
          `because the ${B} only ${needs(Y).replace(/^still /, '')}. ` +
          `So the ${A}'s ${other(d.mines.length)} must ${plural(d.mines.length, 'be a mine', 'all be mines')}.`;
        if (d.safe.length) {
          text += ` That puts all of the ${B}'s ${plural(Y.m, 'mine', 'mines')} in the dashed squares, so its ` +
            `${other(d.safe.length)} ${plural(d.safe.length, 'is', 'are')} safe.`;
        }
      } else {
        text = `Every hidden square next to the ${A} (dashed) also touches the ${B}, and both ` +
          `${X.flagged || Y.flagged ? 'still need' : 'need'} ${mines(X.m)}. So the ${A}'s ` +
          `${plural(X.m, 'mine', 'mines')} also ${plural(X.m, 'satisfies', 'satisfy')} the ${B}, and the ${B}'s ` +
          `${other(d.safe.length)} ${plural(d.safe.length, 'is', 'are')} safe.`;
      }
    } else if (d.rule === 'count-safe') {
      text = `All ${mines(d.known)} are found, so every remaining hidden square is safe.`;
    } else if (d.rule === 'count-mines') {
      text = `There ${plural(d.remaining, 'is', 'are')} ${mines(d.remaining)} left and exactly ${squares(d.remaining)}, ` +
        `so ${plural(d.remaining, 'it is a mine', 'they are all mines')}.`;
    } else if (d.rule === 'region') {
      const what = [
        d.safe.length ? `the green ${plural(d.safe.length, 'square is', 'squares are')} safe` : '',
        d.mines.length ? `the red ${plural(d.mines.length, 'square is a mine', 'squares are mines')}` : '',
      ].filter(Boolean).join(' and ');
      text = `Look at the outlined numbers together${d.usedCount ? `, along with the ${mines(d.remaining)} left` : ''}. ` +
        `There ${d.solutions === 1 ? 'is only one way' : `are only ${d.solutions} ways`} to place the mines around them, ` +
        `and in every one ${what}. Tip: assume the opposite and follow the numbers. You will run into a contradiction.`;
    }

    if (wrongFlags.length) {
      text = `Your ${plural(wrongFlags.length, 'flag on a green square is', 'flags on green squares are')} wrong. ` + text;
    }
    const action = [
      d.safe.length ? `Open the green ${plural(d.safe.length, 'square', 'squares')}` : '',
      toFlag.length ? `flag the red ${plural(toFlag.length, 'one', 'ones')}` : '',
    ].filter(Boolean).join(' and ');
    return { rule: d.rule, safe: d.safe, mines: toFlag, numbers, shared, wrongFlags, text, action: action.charAt(0).toUpperCase() + action.slice(1) + '.' };
  }

  // ---------------------------------------------------------------------------
  // Generator: a board that can be solved from the start cell without guessing.
  // opts.start fixes the start cell (the player's first click); otherwise it is random.
  // The start cell and its neighbours are mine-free, so the first click opens an area.
  // ---------------------------------------------------------------------------
  function generate(rows, cols, mineTotal, rng = Math.random, opts = {}) {
    const maxMs = opts.maxMs ?? 4000;
    const t0 = Date.now();
    const n = rows * cols;
    const nb = neighborTable(rows, cols);
    let attempts = 0;
    let last = null;
    while (true) {
      attempts++;
      const start = opts.start ?? Math.floor(rng() * n);
      const zone = new Set([start, ...nb[start]]);
      let candidates = [];
      for (let i = 0; i < n; i++) if (!zone.has(i)) candidates.push(i);
      if (candidates.length < mineTotal) candidates = [...Array(n).keys()].filter((i) => i !== start);
      const mines = new Uint8Array(n);
      for (let i = 0; i < mineTotal; i++) {
        const j = i + Math.floor(rng() * (candidates.length - i));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        mines[candidates[i]] = 1;
      }
      last = { mines, start, attempts, solvable: false };
      if (solve(rows, cols, mines, start)) {
        last.solvable = true;
        return last;
      }
      if (Date.now() - t0 > maxMs) return last; // give up: very unlikely for standard sizes
    }
  }

  const api = { solve, generate, hint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MinesweeperSolver = api;
})(typeof self !== 'undefined' ? self : this);
