import * as THREE from 'three';

/**
 * Case finishes (spec §10.1). Colors are metal reflectance (what the
 * environment reflections get tinted by), so they read darker than paint.
 * @typedef {'silver'|'green'|'cream'} FinishId
 */
export const FINISHES = {
  silver: { label: 'Silver', color: '#c6c8cb' },
  green: { label: 'Green', color: '#5f6b57' },
  cream: { label: 'Cream', color: '#d6c8ad' },
};

/** @type {FinishId} */
export const DEFAULT_FINISH = 'silver';

/**
 * Display brightness multiplier. Post-processing tone-maps everything
 * (ACES), which would otherwise dull the AMOLED whites to ~90% grey.
 */
const DISPLAY_GAIN = 1.5;

/**
 * Every material the watch uses. All MeshPhysicalMaterial except the display,
 * which is unlit so the canvas pixels show exactly.
 * @param {FinishId} finish
 * @param {THREE.Texture | null} screenTexture
 */
export function createWatchMaterials(finish, screenTexture) {
  const caseColor = new THREE.Color(FINISHES[finish].color);

  // "Armor Aluminum": satin metal, faint circumferential brushing on the lathed case
  const aluminum = new THREE.MeshPhysicalMaterial({
    color: caseColor,
    metalness: 1,
    roughness: 0.28,
    anisotropy: 0.35,
  });

  // lugs and buttons: same metal, no brushing (their UVs don't run around the case)
  const aluminumPlain = new THREE.MeshPhysicalMaterial({ color: caseColor, metalness: 1, roughness: 0.3 });
  const button = new THREE.MeshPhysicalMaterial({ color: caseColor, metalness: 1, roughness: 0.22 });

  // Sapphire: reflections only, added on top of the display so the screen stays readable
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: 0.03,
    ior: 1.77,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  // AMOLED off-pixels: the thin black border between display and case. Unlit, so it stays pure black.
  const panelBlack = new THREE.MeshBasicMaterial({ color: 0x000000 });

  const display = new THREE.MeshBasicMaterial({
    map: screenTexture,
    color: new THREE.Color(DISPLAY_GAIN, DISPLAY_GAIN, DISPLAY_GAIN),
    toneMapped: false,
  });

  const port = new THREE.MeshBasicMaterial({ color: 0x000000 });

  // Underside health sensor: glossy dark dome, darker windows, polished electrode ring
  const sensorGlass = new THREE.MeshPhysicalMaterial({
    color: 0x1b1c1f,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const sensorWindow = new THREE.MeshPhysicalMaterial({
    color: 0x020302,
    roughness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  });
  const electrode = new THREE.MeshPhysicalMaterial({ color: 0xb8bbbf, metalness: 1, roughness: 0.16 });

  // Fluoroelastomer sport band: matte black, soft sheen, fine grain
  const strap = new THREE.MeshPhysicalMaterial({
    color: 0x151517,
    roughness: 0.74,
    sheen: 0.45,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0x3a3a40),
    normalMap: createGrainNormalMap(),
    normalScale: new THREE.Vector2(0.14, 0.14),
  });

  return { aluminum, aluminumPlain, button, glass, panelBlack, display, port, sensorGlass, sensorWindow, electrode, strap };
}

/**
 * @param {ReturnType<typeof createWatchMaterials>} materials
 * @param {FinishId} finish
 */
export function applyFinish(materials, finish) {
  const color = new THREE.Color(FINISHES[finish].color);
  for (const m of [materials.aluminum, materials.aluminumPlain, materials.button]) m.color.copy(color);
}

/**
 * Display brightness, 0 (off) to 1 (normal). Used when the watch wakes at boot.
 * @param {ReturnType<typeof createWatchMaterials>} materials
 * @param {number} level
 */
export function setDisplayLevel(materials, level) {
  materials.display.color.setScalar(DISPLAY_GAIN * level);
}

/**
 * Tiling micro-texture for the strap, generated in code: smoothed value
 * noise as a height field, converted to a tangent-space normal map.
 */
function createGrainNormalMap(size = 256) {
  const rand = mulberry32(7);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = rand();

  // two box-blur passes (wrapping) turn white noise into soft grain
  for (let pass = 0; pass < 2; pass++) {
    const src = height.slice();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += src[((y + dy + size) % size) * size + ((x + dx + size) % size)];
          }
        }
        height[y * size + x] = sum / 9;
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const img = ctx.createImageData(size, size);
  const strength = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = (xx, yy) => height[((yy + size) % size) * size + ((xx + size) % size)];
      const nx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const ny = (h(x, y - 1) - h(x, y + 1)) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Small deterministic PRNG so the grain is identical on every load. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
