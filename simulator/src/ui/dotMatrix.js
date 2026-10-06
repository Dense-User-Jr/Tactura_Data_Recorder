/**
 * 5×7 dot-matrix glyphs for the wordmark animations (boot sequence now, the
 * watch screen's boot state later). Text in general uses the Doto font; this
 * exists so assembling wordmarks can animate individual dots.
 *
 * '#' is a lit dot. Add glyphs as new words need them.
 */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

export const DOT_ROWS = 7;

/**
 * @typedef {Object} DotLayout
 * @property {number} cols                    grid width in dots
 * @property {number} rows                    grid height in dots
 * @property {Array<[number, number]>} lit    [col, row] of every lit dot
 */

/**
 * Lays text out on a dot grid, one blank column between glyphs.
 * @param {string} text
 * @returns {DotLayout}
 */
export function layoutDots(text) {
  /** @type {Array<[number, number]>} */
  const lit = [];
  let x = 0;
  const chars = [...text.toUpperCase()];
  chars.forEach((ch, i) => {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`dotMatrix: no glyph for "${ch}"`);
    glyph.forEach((row, r) => {
      [...row].forEach((cell, c) => {
        if (cell === '#') lit.push([x + c, r]);
      });
    });
    x += glyph[0].length + (i < chars.length - 1 ? 1 : 0);
  });
  return { cols: x, rows: DOT_ROWS, lit };
}
