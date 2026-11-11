// No-guess board generation.
// A logic solver plays the board from the start cell using only deductions a
// careful human could make. Boards it cannot finish are discarded, so every
// accepted board can be cleared without guessing.
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
  const ENUM_MAX_NODES = 100000; // per component, keeps worst case bounded

  // Returns true if the board can be fully cleared from `start` by logic alone.
  function solve(rows, cols, mines, start) {
    const n = rows * cols;
    const nb = neighborTable(rows, cols);
    const adj = new Uint8Array(n);
    let totalMines = 0;
    for (let i = 0; i < n; i++) {
      if (mines[i]) totalMines++;
      for (const j of nb[i]) if (mines[j]) adj[i]++;
    }
    const open = new Uint8Array(n);
    const flag = new Uint8Array(n); // deduced mines
    let opened = 0;
    let flagged = 0;
    const safeTotal = n - totalMines;

    function reveal(i) {
      const stack = [i];
      while (stack.length) {
        const x = stack.pop();
        if (open[x] || flag[x]) continue;
        if (mines[x]) throw new Error('solver opened a mine'); // would mean an unsound deduction
        open[x] = 1;
        opened++;
        if (adj[x] === 0) for (const y of nb[x]) if (!open[y]) stack.push(y);
      }
    }
    function mark(i) {
      if (!flag[i]) { flag[i] = 1; flagged++; }
    }

    reveal(start);

    // Constraint: these unknown cells hold exactly `m` mines.
    function constraints() {
      const list = [];
      for (let i = 0; i < n; i++) {
        if (!open[i] || adj[i] === 0) continue;
        const cells = [];
        let m = adj[i];
        for (const j of nb[i]) {
          if (flag[j]) m--;
          else if (!open[j]) cells.push(j);
        }
        if (cells.length) list.push({ cells, m });
      }
      return list;
    }

    while (opened < safeTotal) {
      let progress = false;
      const cons = constraints();

      // 1. Single number: all remaining neighbours are safe, or all are mines.
      for (const { cells, m } of cons) {
        if (m === 0) { cells.forEach((c) => { if (!open[c]) reveal(c); }); progress = true; }
        else if (m === cells.length) { cells.forEach(mark); progress = true; }
      }
      if (progress) continue;

      // 2. Pairs of overlapping numbers (covers the classic 1-2 / 1-1 patterns).
      const byCell = new Map();
      cons.forEach((k, idx) => k.cells.forEach((c) => {
        if (!byCell.has(c)) byCell.set(c, []);
        byCell.get(c).push(idx);
      }));
      for (let a = 0; a < cons.length && !progress; a++) {
        const A = cons[a];
        const setA = new Set(A.cells);
        const partners = new Set();
        for (const c of A.cells) for (const b of byCell.get(c)) if (b > a) partners.add(b);
        for (const b of partners) {
          const B = cons[b];
          const setB = new Set(B.cells);
          const onlyA = A.cells.filter((c) => !setB.has(c));
          const onlyB = B.cells.filter((c) => !setA.has(c));
          if (A.m - B.m === onlyA.length && (onlyA.length || onlyB.length)) {
            onlyA.forEach(mark); onlyB.forEach((c) => { if (!open[c]) reveal(c); });
            progress = true; break;
          }
          if (B.m - A.m === onlyB.length && (onlyA.length || onlyB.length)) {
            onlyB.forEach(mark); onlyA.forEach((c) => { if (!open[c]) reveal(c); });
            progress = true; break;
          }
        }
      }
      if (progress) continue;

      // 3. Mine count: every mine found, or every unknown cell is a mine.
      const remaining = totalMines - flagged;
      const unknown = [];
      for (let i = 0; i < n; i++) if (!open[i] && !flag[i]) unknown.push(i);
      if (remaining === 0) { unknown.forEach((c) => { if (!open[c]) reveal(c); }); continue; }
      if (remaining === unknown.length) { unknown.forEach(mark); continue; }

      // 4. Enumerate every consistent mine layout per frontier region;
      //    cells that are safe (or mined) in all layouts are certain.
      if (enumerate(cons, byCell, remaining, unknown.length)) continue;

      return false; // stuck: the next move would be a guess
    }
    return true;

    function enumerate(cons, byCell, remaining, unknownCount) {
      // Split frontier cells into independent regions.
      const seen = new Set();
      const regions = [];
      for (const start of byCell.keys()) {
        if (seen.has(start)) continue;
        const cells = [];
        const cIdx = new Set();
        const queue = [start];
        seen.add(start);
        while (queue.length) {
          const c = queue.pop();
          cells.push(c);
          for (const k of byCell.get(c)) {
            if (cIdx.has(k)) continue;
            cIdx.add(k);
            for (const d of cons[k].cells) if (!seen.has(d)) { seen.add(d); queue.push(d); }
          }
        }
        regions.push({ cells, cons: [...cIdx].map((k) => cons[k]) });
      }
      const frontierCount = seen.size;
      const interior = unknownCount - frontierCount;
      // With a single region and no hidden interior, the total mine count must match exactly.
      const exact = regions.length === 1 && interior === 0 ? remaining : -1;

      let progress = false;
      for (const reg of regions) {
        if (reg.cells.length > ENUM_MAX_CELLS) continue;
        const res = enumerateRegion(reg, exact, remaining);
        if (!res) continue;
        reg.cells.forEach((c, i) => {
          if (res.mineCount[i] === 0) { if (!open[c]) reveal(c); progress = true; }
          else if (res.mineCount[i] === res.solutions) { mark(c); progress = true; }
        });
      }
      return progress;
    }

    function enumerateRegion(reg, exact, maxMines) {
      const cells = reg.cells;
      const pos = new Map(cells.map((c, i) => [c, i]));
      const cs = reg.cons.map((k) => ({ idx: k.cells.map((c) => pos.get(c)), m: k.m }));
      const cellCons = cells.map(() => []);
      cs.forEach((k, ki) => k.idx.forEach((i) => cellCons[i].push(ki)));
      const assigned = new Int8Array(cells.length).fill(-1);
      const placed = new Int32Array(cs.length); // mines assigned per constraint
      const free = cs.map((k) => k.idx.length); // unassigned cells per constraint
      const mineCount = new Int32Array(cells.length);
      let solutions = 0;
      let nodes = 0;
      let total = 0;
      let aborted = false;

      function ok(i) {
        for (const k of cellCons[i]) {
          if (placed[k] > cs[k].m || placed[k] + free[k] < cs[k].m) return false;
        }
        return true;
      }
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
  }

  // Generate a board that can be solved from the start cell without guessing.
  // opts.start fixes the start cell (the player's first click); otherwise it is random.
  // The start cell and its neighbours are mine-free, so the first click opens an area.
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

  const api = { solve, generate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MinesweeperSolver = api;
})(typeof self !== 'undefined' ? self : this);
