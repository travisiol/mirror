"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero object: a matte violet disc cut vertically in two, rendered live
 * with three.js (no image). A flat SVG of the same shape shows until WebGL
 * is ready, and stays if WebGL is unavailable.
 *
 * `pulse` is any value that changes when the mirror rate changes: the two
 * halves part a little and settle back.
 */
export function SplitDisc({ pulse }: { pulse: number }) {
  const host = useRef<HTMLDivElement>(null);
  const kick = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      const { toCreasedNormals } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
      if (disposed) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return; // no WebGL: the SVG stays
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      element.appendChild(renderer.domElement);

      const styles = getComputedStyle(element);
      const token = (name: string) => new THREE.Color(styles.getPropertyValue(name).trim());

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(12, 1, 0.1, 60);
      camera.position.set(0, 0.45, 11.5);
      camera.lookAt(0, 0, 0);

      scene.add(new THREE.HemisphereLight(0xffffff, 0xcbb9e6, 1.05));
      const key = new THREE.DirectionalLight(0xffffff, 1.15);
      key.position.set(-3.2, 3.6, 5);
      scene.add(key);
      // A near light gives the flat faces their soft top-left to bottom-right falloff.
      const glow = new THREE.PointLight(0xffffff, 26, 0, 2);
      glow.position.set(-2.1, 2.3, 3.1);
      scene.add(glow);
      const rim = new THREE.DirectionalLight(0xe8dcff, 1.3);
      rim.position.set(4, 1, 2);
      scene.add(rim);

      // Half a cylinder with softly rounded edges. `side` = -1 (left) or 1 (right).
      const R = 1;
      const DEPTH = 0.54;
      const BEVEL = 0.11;
      const half = (side: 1 | -1) => {
        const shape = new THREE.Shape();
        if (side === 1) {
          shape.moveTo(0, -R);
          shape.absarc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
        } else {
          shape.moveTo(0, R);
          shape.absarc(0, 0, R, Math.PI / 2, (3 * Math.PI) / 2, false);
        }
        shape.closePath();
        const extruded = new THREE.ExtrudeGeometry(shape, {
          depth: DEPTH,
          curveSegments: 72,
          bevelEnabled: true,
          bevelThickness: BEVEL,
          bevelSize: BEVEL,
          bevelOffset: -BEVEL,
          bevelSegments: 12,
        });
        extruded.translate(0, 0, -DEPTH / 2);
        const geometry = toCreasedNormals(extruded, Math.PI / 5);
        extruded.dispose();
        const material = new THREE.MeshStandardMaterial({
          color: token(side === 1 ? "--color-disc-right" : "--color-disc-left"),
          roughness: 0.44,
          metalness: 0,
        });
        return new THREE.Mesh(geometry, material);
      };

      const left = half(-1);
      const right = half(1);
      const disc = new THREE.Group();
      disc.add(left, right);
      scene.add(disc);

      const GAP = 0.235;
      const TURN = -0.4;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let spread = 0; // extra gap, decays to 0
      let velocity = 0;
      kick.current = () => {
        velocity += 0.55;
      };

      const fit = () => {
        const { clientWidth: width, clientHeight: height } = element;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      const draw = (time: number) => {
        const t = still ? 0 : time / 1000;
        disc.rotation.y = TURN + Math.sin(t * 0.55) * 0.045;
        disc.rotation.x = Math.sin(t * 0.4) * 0.018;
        disc.position.y = -0.085 + Math.sin(t * 0.8) * 0.012;
        left.position.x = -(GAP + spread);
        right.position.x = GAP + spread;
        renderer.render(scene, camera);
      };

      let frame = 0;
      let last = performance.now();
      let visible = true;
      const loop = (time: number) => {
        const dt = Math.min(0.05, (time - last) / 1000);
        last = time;
        // critically damped-ish spring back to the resting gap
        velocity += (-spread * 60 - velocity * 9) * dt;
        spread = Math.max(0, spread + velocity * dt);
        draw(time);
        frame = visible && !still ? requestAnimationFrame(loop) : 0;
      };

      fit();
      draw(0);
      setReady(true);
      if (!still) frame = requestAnimationFrame(loop);

      const resize = new ResizeObserver(() => {
        fit();
        draw(performance.now());
      });
      resize.observe(element);
      const seen = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !frame && !still) {
          last = performance.now();
          frame = requestAnimationFrame(loop);
        }
      });
      seen.observe(element);

      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        seen.disconnect();
        for (const mesh of [left, right]) {
          mesh.geometry.dispose();
          (mesh.material as import("three").Material).dispose();
        }
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    kick.current();
  }, [pulse]);

  return (
    <div ref={host} className="disc" data-ready={ready} role="img" aria-label="A violet disc cut in two halves">
      <svg viewBox="0 0 340 300" aria-hidden="true">
        <defs>
          <linearGradient id="disc-l" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c7a6ea" />
            <stop offset="1" stopColor="#a67ad6" />
          </linearGradient>
          <linearGradient id="disc-r" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8456c5" />
            <stop offset="1" stopColor="#6c3cb2" />
          </linearGradient>
        </defs>
        <path d="M160 22A128 128 0 0 0 160 278Z" fill="url(#disc-l)" />
        <path d="M182 20A130 130 0 0 1 182 280Z" fill="url(#disc-r)" />
      </svg>
    </div>
  );
}
