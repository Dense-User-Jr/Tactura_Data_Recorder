import * as THREE from 'three';
import { h } from '../ui/dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LEAD_PX = 30; // elbow distance beyond the case silhouette
const SHELF_PX = 26; // horizontal run into the label

/**
 * @typedef {import('./watch/WatchModel.js').Anchor} Anchor
 * @typedef {Object} Callout
 * @property {string} num               e.g. `01`
 * @property {string} text              e.g. `HOME KEY`
 * @property {Anchor} anchor            in the target object's local space
 * @property {[number, number]} prefer  screen direction (x right, y down) when the anchor sits near the center
 */

/**
 * Technical-drawing callouts (spec §10.6): a dot on the 3D anchor, a hairline
 * elbow out past the case edge, and a Space Mono label. Re-projected every
 * frame; each fades out as its anchor turns away from the camera. Internal
 * parts (the IMU) draw a dashed line and stay visible.
 */
export class Annotations {
  /**
   * @param {HTMLElement} root  full-viewport overlay above the canvas
   * @param {{ camera: THREE.Camera, target: THREE.Object3D, radiusMm: number, callouts: Callout[] }} options
   */
  constructor(root, { camera, target, radiusMm, callouts }) {
    this.root = root;
    this.camera = camera;
    this.target = target;
    this.radiusMm = radiusMm;
    /** @type {HTMLElement | null} labels stay inside this element (the HUD's viewport cell) */
    this.boundsEl = null;

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'ann__lines');
    root.append(this.svg);

    this.items = callouts.map((c) => {
      const internal = c.anchor.normal === null;
      const g = document.createElementNS(SVG_NS, 'g');
      const line = document.createElementNS(SVG_NS, 'polyline');
      line.setAttribute('class', internal ? 'ann__line ann__line--internal' : 'ann__line');
      const mark = document.createElementNS(SVG_NS, internal ? 'rect' : 'circle');
      mark.setAttribute('class', 'ann__mark');
      if (internal) {
        mark.setAttribute('width', '5');
        mark.setAttribute('height', '5');
      } else {
        mark.setAttribute('r', '2.2');
      }
      g.append(line, mark);
      this.svg.append(g);
      const label = h(
        'div',
        { class: 'ann__label label' },
        h('span', { class: 'panel__num' }, c.num),
        h('span', { class: 'panel__sep' }, '/'),
        h('span', {}, c.text),
      );
      root.append(label);
      return { ...c, internal, g, line, mark, label };
    });

    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._scale = new THREE.Vector3();
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this.root.classList.toggle('is-hidden', !visible);
  }

  /** Keep labels inside this element, flipping them to the other side of the watch if needed. @param {HTMLElement} el */
  setBounds(el) {
    this.boundsEl = el;
  }

  /** Re-project every callout. Call after the camera and the watch have moved for this frame. */
  update() {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (!width || !height) return;
    this.target.updateWorldMatrix(true, false);

    const toScreen = (world) => {
      const p = this._v.copy(world).project(this.camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };

    const centerWorld = this.target.localToWorld(new THREE.Vector3());
    const center = toScreen(centerWorld);
    this.target.getWorldScale(this._scale);
    this._right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const edge = toScreen(centerWorld.clone().addScaledVector(this._right, this.radiusMm * this._scale.x));
    const radiusPx = Math.hypot(edge.x - center.x, edge.y - center.y);
    const bounds = this.boundsEl?.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();

    for (const item of this.items) {
      const world = this.target.localToWorld(item.anchor.position.clone());
      const p = toScreen(world);

      let alpha = 1;
      if (item.anchor.normal) {
        this._n.copy(item.anchor.normal).transformDirection(this.target.matrixWorld);
        this._view.copy(this.camera.position).sub(world).normalize();
        alpha = THREE.MathUtils.smoothstep(this._n.dot(this._view), 0.04, 0.34);
      }

      let dx = p.x - center.x;
      let dy = p.y - center.y;
      const len = Math.hypot(dx, dy);
      if (item.internal || len < radiusPx * 0.25) [dx, dy] = item.prefer;
      else [dx, dy] = [dx / len, dy / len];

      const layout = (ux) => {
        const elbow = { x: center.x + ux * (radiusPx + LEAD_PX), y: center.y + dy * (radiusPx + LEAD_PX) };
        const side = ux >= 0 ? 1 : -1;
        const end = { x: elbow.x + side * SHELF_PX, y: elbow.y };
        return { elbow, side, end };
      };
      let { elbow, side, end } = layout(dx);
      if (bounds) {
        // labels that would leave the viewport cell (e.g. under a rail) go to the other side
        const width = (item.width ||= item.label.offsetWidth);
        const left = root.left + (side > 0 ? end.x + 6 : end.x - 6 - width);
        if (left < bounds.left + 12 || left + width > bounds.right - 12) ({ elbow, side, end } = layout(-dx));
        const top = bounds.top - root.top + 36;
        const bottom = bounds.bottom - root.top - 36;
        elbow.y = end.y = THREE.MathUtils.clamp(elbow.y, top, bottom);
      }

      item.g.style.opacity = String(alpha);
      item.line.setAttribute('points', `${p.x},${p.y} ${elbow.x},${elbow.y} ${end.x},${end.y}`);
      if (item.internal) {
        item.mark.setAttribute('x', String(p.x - 2.5));
        item.mark.setAttribute('y', String(p.y - 2.5));
      } else {
        item.mark.setAttribute('cx', String(p.x));
        item.mark.setAttribute('cy', String(p.y));
      }
      item.label.style.opacity = String(alpha);
      item.label.style.transform =
        `translate(${end.x + side * 6}px, ${end.y}px) translate(${side > 0 ? '0' : '-100%'}, -50%)`;
    }
  }
}
