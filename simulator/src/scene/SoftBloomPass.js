import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * UnrealBloomPass tuned for this scene and for integrated GPUs:
 *
 * - Clamps radiance in the bright-pass. Specular glints on polished metal
 *   reach 50+ and would flood the frame with glow; the clamp bounds the glow
 *   without touching the image itself (ACES maps anything above ~3 to
 *   near-white anyway).
 * - Runs the whole blur chain at `scale` of the frame (default half). At
 *   device pixel ratio 2 a full-resolution bloom cost ~70% of the frame on an
 *   Intel Arc iGPU; the blur hides the lower resolution.
 */
export class SoftBloomPass extends UnrealBloomPass {
  /**
   * @param {{ strength: number, radius: number, threshold: number, limit?: number, scale?: number }} options
   */
  constructor({ strength, radius, threshold, limit = 3, scale = 0.5 }) {
    super(new THREE.Vector2(1, 1), strength, radius, threshold);
    this.scale = scale;

    // same uniforms object the base class updates every frame, plus the clamp
    this.highPassUniforms.limit = { value: limit };
    this.materialHighPassFilter.dispose();
    this.materialHighPassFilter = new THREE.ShaderMaterial({
      uniforms: this.highPassUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec3 defaultColor;
        uniform float defaultOpacity;
        uniform float luminosityThreshold;
        uniform float smoothWidth;
        uniform float limit;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(tDiffuse, vUv);
          texel.rgb = min(texel.rgb, vec3(limit));
          float v = luminance(texel.rgb);
          float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
          gl_FragColor = mix(vec4(defaultColor, defaultOpacity), texel, alpha);
        }`,
    });
  }

  /** @param {number} width @param {number} height */
  setSize(width, height) {
    const scale = this.scale ?? 0.5; // also safe if a base-class version ever calls this from its constructor
    super.setSize(Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale)));
  }
}
