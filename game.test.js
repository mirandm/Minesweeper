// Run with: node --test
const test = require('node:test');
const assert = require('node:assert');
const { Game, DIFFICULTIES } = require('./game.js');

// Build a game with mines at fixed positions, skipping random placement.
function rigged(rows, cols, minePositions) {
  const g = new Game(rows, cols, minePositions.length, Math.random, { noGuess: false });
  g.placeMines = function () {
    for (const [r, c] of minePositions) this.cell(r, c).mine = true;
    for (const x of this.cells) x.adj = this.neighbors(x.r, x.c).filter((n) => n.mine).length;
  };
  return g;
}

test('first click is always safe and clears its neighbours', () => {
  for (let i = 0; i < 200; i++) {
    const { rows, cols, mines } = DIFFICULTIES.expert;
    const g = new Game(rows, cols, mines, Math.random, { noGuess: false });
    const r = i % rows;
    const c = (i * 7) % cols;
    g.reveal(r, c);
    assert.notStrictEqual(g.state, 'lost');
    assert.strictEqual(g.cells.filter((x) => x.mine).length, mines);
    assert.strictEqual(g.cell(r, c).adj, 0);
  }
});

test('first click is safe even on a nearly full board', () => {
  const g = new Game(3, 3, 8, Math.random, { noGuess: false });
  g.reveal(1, 1);
  assert.strictEqual(g.state, 'won');
});

test('flood fill opens connected empty area', () => {
  const g = rigged(4, 4, [[3, 3]]);
  g.reveal(0, 0);
  assert.strictEqual(g.opened, 15);
  assert.strictEqual(g.state, 'won');
  assert.ok(g.cell(3, 3).flag, 'mines are auto-flagged on win');
});

test('opening a mine loses', () => {
  const g = rigged(3, 3, [[0, 0], [0, 2]]);
  g.reveal(2, 1); // opens bottom two rows, (0,1) still closed
  assert.strictEqual(g.state, 'playing');
  g.reveal(0, 0);
  assert.strictEqual(g.state, 'lost');
  assert.ok(g.cell(0, 0).exploded);
});

test('flagged cells cannot be opened and flags count down', () => {
  const g = rigged(3, 3, [[0, 0]]);
  g.toggleFlag(0, 0);
  assert.strictEqual(g.minesLeft, 0);
  g.reveal(0, 0);
  assert.strictEqual(g.cell(0, 0).open, false);
  g.toggleFlag(0, 0);
  assert.strictEqual(g.minesLeft, 1);
});

test('chord opens neighbours when flag count matches', () => {
  const g = rigged(3, 3, [[0, 0]]);
  g.reveal(1, 1); // adj = 1, does not flood
  assert.strictEqual(g.opened, 1);
  g.toggleFlag(0, 0);
  g.reveal(1, 1); // chord
  assert.strictEqual(g.state, 'won');
});

test('chord with a wrong flag loses', () => {
  const g = rigged(3, 3, [[0, 0]]);
  g.reveal(1, 1);
  g.toggleFlag(0, 1);
  g.reveal(1, 1);
  assert.strictEqual(g.state, 'lost');
});

test('no actions after game over', () => {
  const g = rigged(3, 3, [[0, 0]]);
  g.reveal(1, 1);
  g.state = 'lost';
  g.toggleFlag(2, 2);
  g.reveal(2, 2);
  assert.strictEqual(g.cell(2, 2).flag, false);
  assert.strictEqual(g.cell(2, 2).open, false);
});

const { solve } = require('./solver.js');

test('no-guess boards: solvable by logic from wherever the first click is', () => {
  for (const { rows, cols, mines } of Object.values(DIFFICULTIES)) {
    const corners = [[0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1]];
    for (let i = 0; i < 20; i++) {
      const [r, c] = i < 4 ? corners[i] : [Math.floor(Math.random() * rows), Math.floor(Math.random() * cols)];
      const g = new Game(rows, cols, mines);
      g.reveal(r, c);
      assert.ok(g.solvable, 'generator found a solvable board');
      assert.strictEqual(g.cells.filter((x) => x.mine).length, mines);
      assert.strictEqual(g.cell(r, c).adj, 0, 'first click opens an area');
      assert.ok(g.opened > 1);
      const arr = Uint8Array.from(g.cells, (x) => (x.mine ? 1 : 0));
      assert.ok(solve(rows, cols, arr, r * cols + c));
    }
  }
});

test('solver needs a guess on a classic 50/50 and reports unsolvable', () => {
  // Two cells in the corner of a 2x3 strip, one mine between them: no information can separate them.
  // Layout (rows x cols = 2 x 3):   . . M      start at (0,0)
  //                                 . . .
  // Cells (0,2) and (1,2) both border only (0,1)/(1,1) which see one mine each -> 50/50.
  const mines = Uint8Array.from([0, 0, 1, 0, 0, 0]);
  assert.strictEqual(solve(2, 3, mines, 0), false);
});

test('solver handles a simple logical board', () => {
  // 1x4 strip, mine at the end: start at 0 opens 0,1 -> (2) shows 1 -> (3) must be the mine.
  const mines = Uint8Array.from([0, 0, 0, 1]);
  assert.strictEqual(solve(1, 4, mines, 0), true);
});

const { hint } = require('./solver.js');
const viewOf = (g) => ({
  open: g.cells.map((x) => (x.open ? 1 : 0)),
  adj: g.cells.map((x) => (x.open ? x.adj : 0)),
  flag: g.cells.map((x) => (x.flag ? 1 : 0)),
});

test('following hints alone always wins, and every hint is correct', () => {
  for (const { rows, cols, mines } of Object.values(DIFFICULTIES)) {
    for (let i = 0; i < 10; i++) {
      const g = new Game(rows, cols, mines);
      g.reveal(Math.floor(Math.random() * rows), Math.floor(Math.random() * cols));
      let steps = 0;
      while (g.state === 'playing') {
        const h = hint(rows, cols, mines, viewOf(g));
        assert.notStrictEqual(h.rule, 'none', 'a hint is always available');
        assert.ok(h.text.length > 20 && h.action.length > 3);
        for (const c of h.safe) assert.strictEqual(g.cells[c].mine, false, 'hinted safe square is safe');
        for (const c of h.mines) assert.strictEqual(g.cells[c].mine, true, 'hinted mine is a mine');
        for (const c of h.mines) g.toggleFlag(g.cells[c].r, g.cells[c].c);
        for (const c of h.safe) g.reveal(g.cells[c].r, g.cells[c].c);
        assert.ok(++steps < 2000);
      }
      assert.strictEqual(g.state, 'won');
    }
  }
});

test('hint explains the 1-2-1 pattern with an overlapping pair', () => {
  // 2x3: top row hidden, bottom row shows 1 2 1; mines in both top corners.
  const h = hint(2, 3, 2, { open: [0, 0, 0, 1, 1, 1], adj: [0, 0, 0, 1, 2, 1], flag: [0, 0, 0, 0, 0, 0] });
  assert.strictEqual(h.rule, 'pair');
  assert.deepStrictEqual(h.numbers.map((x) => x.label), ['A', 'B']);
  assert.strictEqual(h.mines.length, 1);
  assert.match(h.text, /blue 2.*pink 1/);
});

test('hint catches a flag placed on a safe square, with the reason', () => {
  // 1-2-1 pattern; the player wrongly flagged the safe middle-top square (cell 1).
  const v = { open: [0, 0, 0, 1, 1, 1], adj: [0, 0, 0, 1, 2, 1], flag: [0, 1, 0, 0, 0, 0] };
  let h = hint(2, 3, 2, v);
  assert.ok(!h.mines.includes(1), 'never trusts the wrong flag');
  v.flag[2] = 1; // player flags the proven mine at top-right
  h = hint(2, 3, 2, v);
  assert.deepStrictEqual(h.safe, [1]);
  assert.deepStrictEqual(h.wrongFlags, [1]);
  assert.match(h.text, /^Your flag on a green square is wrong\./);
});

test('no hint when only a guess is left', () => {
  // 2x3 with one mine top-right; bottom-left area open; (0,2)/(1,2) is a 50/50.
  const h = hint(2, 3, 1, { open: [1, 1, 0, 1, 1, 0], adj: [0, 1, 0, 0, 1, 0], flag: [0, 0, 0, 0, 0, 0] });
  assert.strictEqual(h.rule, 'none');
});

test('app.js has no duplicate function names (a later one silently replaces the earlier)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');
  const names = [...src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepStrictEqual(dupes, []);
});
