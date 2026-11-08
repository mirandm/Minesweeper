// Core Minesweeper logic. No DOM access, so it can be unit-tested in Node.
(function (root) {
  'use strict';

  const DIFFICULTIES = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 },
  };

  class Game {
    constructor(rows, cols, mines, rng = Math.random) {
      if (mines >= rows * cols) throw new Error('Too many mines');
      this.rows = rows;
      this.cols = cols;
      this.mines = mines;
      this.rng = rng;
      this.state = 'ready'; // ready | playing | won | lost
      this.flags = 0;
      this.opened = 0;
      this.cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          this.cells.push({ r, c, mine: false, adj: 0, open: false, flag: false, exploded: false });
        }
      }
    }

    cell(r, c) {
      return this.cells[r * this.cols + c];
    }

    inBounds(r, c) {
      return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
    }

    neighbors(r, c) {
      const out = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if ((dr || dc) && this.inBounds(r + dr, c + dc)) out.push(this.cell(r + dr, c + dc));
        }
      }
      return out;
    }

    get isOver() {
      return this.state === 'won' || this.state === 'lost';
    }

    // Place mines after the first click so the first click is always safe.
    // Prefer keeping the clicked cell's neighbours clear too, so it opens an area.
    placeMines(safeR, safeC) {
      const first = this.cell(safeR, safeC);
      const zone = new Set([first, ...this.neighbors(safeR, safeC)]);
      let candidates = this.cells.filter((x) => !zone.has(x));
      if (candidates.length < this.mines) candidates = this.cells.filter((x) => x !== first);
      // Partial Fisher–Yates shuffle.
      for (let i = 0; i < this.mines; i++) {
        const j = i + Math.floor(this.rng() * (candidates.length - i));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        candidates[i].mine = true;
      }
      for (const x of this.cells) {
        x.adj = this.neighbors(x.r, x.c).filter((n) => n.mine).length;
      }
    }

    // Open a cell. Opening an already-open number chords instead.
    reveal(r, c) {
      if (this.isOver || !this.inBounds(r, c)) return;
      const target = this.cell(r, c);
      if (target.flag) return;
      if (target.open) {
        this.chord(r, c);
        return;
      }
      if (this.state === 'ready') {
        this.placeMines(r, c);
        this.state = 'playing';
      }
      this.openCells([target]);
    }

    // If a number has exactly that many flags around it, open the rest.
    chord(r, c) {
      const target = this.cell(r, c);
      if (this.isOver || !target.open || target.adj === 0) return;
      const around = this.neighbors(r, c);
      if (around.filter((n) => n.flag).length !== target.adj) return;
      this.openCells(around.filter((n) => !n.flag && !n.open));
    }

    openCells(start) {
      const stack = [...start];
      while (stack.length) {
        const x = stack.pop();
        if (x.open || x.flag) continue;
        x.open = true;
        if (x.mine) {
          x.exploded = true;
          this.lose();
          return;
        }
        this.opened++;
        if (x.adj === 0) stack.push(...this.neighbors(x.r, x.c));
      }
      if (this.opened === this.rows * this.cols - this.mines) this.win();
    }

    toggleFlag(r, c) {
      if (this.isOver || !this.inBounds(r, c)) return;
      const x = this.cell(r, c);
      if (x.open) return;
      x.flag = !x.flag;
      this.flags += x.flag ? 1 : -1;
    }

    win() {
      this.state = 'won';
      for (const x of this.cells) {
        if (x.mine && !x.flag) {
          x.flag = true;
          this.flags++;
        }
      }
    }

    lose() {
      this.state = 'lost';
    }

    get minesLeft() {
      return this.mines - this.flags;
    }
  }

  const api = { Game, DIFFICULTIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Minesweeper = api;
})(typeof self !== 'undefined' ? self : this);
