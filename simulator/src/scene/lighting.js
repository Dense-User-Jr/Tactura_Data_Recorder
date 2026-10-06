import * as THREE from 'three';

/**
 * Studio lighting (spec §10.2).
 *
 * - Reflections: a small studio built in code (dark room, a few softbox
 *   panels), prefiltered through PMREMGenerator. Same technique as three's
 *   RoomEnvironment and still no HDR file, but dark like a product-shot
 *   studio: RoomEnvironment's evenly bright grey room washed the AMOLED
 *   blacks to grey and made the aluminum read flat white.
 * - Key light from the viewer's upper left and a cool rim light from behind
 *   right. Both ride with the camera, so every orbit angle stays studio-lit
 *   while the softbox reflections stay fixed in the world and slide across
 *   the metal as you orbit.
 * - Low hemisphere ambient.
 * - A soft contact shadow on the floor under the strap loop (a blurred
 *   radial texture on a plane, no real-time shadow maps).
 */

const LEVELS = {
  environment: 1,
  key: 1.6,
  rim: 2.2,
  ambient: 0.12,
  shadow: 1,
};

/**
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ floorY: number }} stage  floor height in world units
 */
export function createLighting(scene, renderer, { floorY }) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = createStudioScene();
  scene.environment = pmrem.fromScene(studio, 0.035).texture;
  disposeScene(studio);
  pmrem.dispose();

  const rig = new THREE.Group();
  rig.name = 'lightRig';
  const target = new THREE.Object3D();

  const key = new THREE.DirectionalLight(0xffffff, LEVELS.key);
  key.position.set(-3.2, 3.4, 3.6); // camera space: upper left, in front
  key.target = target;

  const rim = new THREE.DirectionalLight(0xc9dcff, LEVELS.rim);
  rim.position.set(3.8, 1.2, -3.6); // camera space: right, behind the watch
  rim.target = target;

  rig.add(key, rim, target);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x0a0a0b, LEVELS.ambient);
  const shadow = createContactShadow(floorY);
  scene.add(rig, ambient, shadow);

  let level = 1;

  return {
    /**
     * 0 = dark, 1 = full studio light. Used by the boot fade-in.
     * @param {number} t
     */
    setLevel(t) {
      level = t;
      scene.environmentIntensity = LEVELS.environment * t;
      key.intensity = LEVELS.key * t;
      rim.intensity = LEVELS.rim * t;
      ambient.intensity = LEVELS.ambient * t;
      /** @type {THREE.MeshBasicMaterial} */ (shadow.material).opacity = LEVELS.shadow * t;
    },
    get level() {
      return level;
    },
    /** Keeps the key and rim lights fixed relative to the viewer. @param {THREE.Camera} camera */
    update(camera) {
      rig.quaternion.copy(camera.quaternion);
    },
    /**
     * Places the contact shadow (world units; scale 1 = 100 × 72 mm).
     * @param {{ x: number, y: number, z: number, scaleX: number, scaleZ: number }} place
     */
    setShadow({ x, y, z, scaleX, scaleZ }) {
      shadow.position.set(x, y, z);
      shadow.scale.set(scaleX, scaleZ, 1); // the plane is laid flat, so its local Y runs along world Z
    },
  };
}

/**
 * The reflection studio: a near-black room with emissive softboxes. Emission
 * above 1.0 is HDR, which is what gives the metal its bright edge highlights.
 * Positions are in world space around the watch (camera starts on +Z).
 */
function createStudioScene() {
  const scene = new THREE.Scene();

  const room = new THREE.Mesh(
    new THREE.BoxGeometry(24, 16, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.016, 0.016, 0.018), side: THREE.BackSide }),
  );
  room.position.y = 2;
  scene.add(room);

  /**
   * @param {[number, number]} size
   * @param {[number, number, number]} position
   * @param {number} intensity
   * @param {number} [tint] hex
   */
  const softbox = (size, position, intensity, tint = 0xffffff) => {
    const color = new THREE.Color(tint).multiplyScalar(intensity);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(...size),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };

  softbox([9, 5], [0, 8, 1.5], 2.6); //                  overhead
  softbox([2.2, 9], [-7, 1.5, 5], 7); //                  key strip, front left
  softbox([1.4, 9], [8, 1, -5], 6, 0xd4e2ff); //          rim strip, back right, cool
  softbox([6, 3], [6, -1.5, 7], 0.7); //                  low front-right fill
  softbox([7, 2.2], [-2.5, 4.5, 8], 0.55); //             behind the viewer: faint sheen on the glass
  softbox([14, 14], [0, -7.5, 0], 0.06); //               faint floor bounce

  return scene;
}

/** @param {THREE.Scene} scene */
function disposeScene(scene) {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
  });
}

/** @param {number} floorY */
function createContactShadow(floorY) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.34)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.72),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.name = 'contactShadow';
  mesh.rotation.x = -Math.PI / 2;
  // centered under the strap loop, which sits mostly behind the upright case
  mesh.position.set(0, floorY, -0.17);
  mesh.renderOrder = -1;
  return mesh;
}
