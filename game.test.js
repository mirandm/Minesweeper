// Run with: node --test
const test = require('node:test');
const assert = require('node:assert');
const { Game, DIFFICULTIES } = require('./game.js');

// Build a game with mines at fixed positions, skipping random placement.
function rigged(rows, cols, minePositions) {
  const g = new Game(rows, cols, minePositions.length);
  g.placeMines = function () {
    for (const [r, c] of minePositions) this.cell(r, c).mine = true;
    for (const x of this.cells) x.adj = this.neighbors(x.r, x.c).filter((n) => n.mine).length;
  };
  return g;
}

test('first click is always safe and clears its neighbours', () => {
  for (let i = 0; i < 200; i++) {
    const { rows, cols, mines } = DIFFICULTIES.expert;
    const g = new Game(rows, cols, mines);
    const r = i % rows;
    const c = (i * 7) % cols;
    g.reveal(r, c);
    assert.notStrictEqual(g.state, 'lost');
    assert.strictEqual(g.cells.filter((x) => x.mine).length, mines);
    assert.strictEqual(g.cell(r, c).adj, 0);
  }
});

test('first click is safe even on a nearly full board', () => {
  const g = new Game(3, 3, 8);
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
