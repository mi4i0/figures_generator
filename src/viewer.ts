import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BadgeModel } from './types';

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();

  constructor(private container: HTMLElement) {
    const w = container.clientWidth || 300;
    const h = container.clientHeight || 260;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    this.camera.position.set(0, -45, 40);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(20, -30, 50);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-30, 20, 20);
    this.scene.add(dir2);

    this.scene.add(this.group);

    window.addEventListener('resize', () => this.onResize());
    this.animate();
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  setModel(model: BadgeModel): void {
    this.group.clear();

    for (const mesh of model.meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
      geo.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
      geo.computeVertexNormals();

      const isNegative = mesh.subtype === 'negative_part';
      const colorHex = model.filamentColors[mesh.extruder - 1] ?? '#888888';
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(isNegative ? '#ff4d4d' : colorHex),
        metalness: 0.1,
        roughness: 0.7,
        transparent: isNegative,
        opacity: isNegative ? 0.35 : 1,
      });
      this.group.add(new THREE.Mesh(geo, material));
    }

    // Frame the model.
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.getSize(new THREE.Vector3()).length() || 30;
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    this.camera.position.set(center.x, center.y - size * 1.1, center.z + size * 0.9);
    this.camera.updateProjectionMatrix();
  }
}
