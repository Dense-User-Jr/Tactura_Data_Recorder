/**
 * Small canvas helpers shared by screen apps. Colors follow the HUD tokens
 * (§7.2); true black is the AMOLED "off".
 */

export const INK = {
  text: '#F4F4F1',
  muted: '#8C8C93',
  dim: '#55555C',
  line: '#2A2A2F',
  lineStrong: '#3D3D44',
  accent: '#FF3B2F',
};

export const easeOutCubic = (p) => 1 - (1 - p) ** 3;
export const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
export const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/**
 * Rectangle with the signature 45° cut on its top-right corner.
 * @param {CanvasRenderingContext2D} ctx
 */
export function chamferPath(ctx, x, y, w, h, c) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

/**
 * Sets the font, shrinking it until `text` fits `maxWidth`.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {{ maxWidth: number, maxSize: number, minSize?: number, weight?: number, family: string }} o
 * @returns {number} the size used
 */
export function fitFont(ctx, text, { maxWidth, maxSize, minSize = 12, weight = 400, family }) {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) {
    size = Math.max(minSize, Math.floor((maxSize * maxWidth) / width));
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

/**
 * Centered, letter-spaced label (Space Mono microcopy style).
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y baseline
 * @param {{ size: number, color: string, spacing?: number, weight?: number }} o
 */
export function label(ctx, text, x, y, { size, color, spacing = 0.12, weight = 400 }) {
  ctx.save();
  ctx.font = `${weight} ${size}px "Space Mono"`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  const px = size * spacing;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${px}px`;
    ctx.fillText(text, x + px / 2, y); // letterSpacing adds trailing space; re-center
  } else {
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}
