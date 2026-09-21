import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { districts, districtById, type District } from '../districts';
import type { JevModel, DistrictId } from '../sim/model';

type View = ReturnType<JevModel['view']>;
interface Building {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
  towers: THREE.Mesh[];
  label: HTMLButtonElement;
  anchor: THREE.Vector3;
  corners: THREE.Vector3[];
}

export function createCity(host: HTMLElement, onSelect: (id: DistrictId) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Jev decision districts and animated request paths');
  renderer.domElement.setAttribute('role', 'img');
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9eff1');
  const camera = new THREE.OrthographicCamera(-18, 18, 12, -12, .1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minZoom = .6;
  controls.maxZoom = 2.4;
  controls.minPolarAngle = .12;
  controls.maxPolarAngle = Math.PI * .44;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x617572, 2.5));
  const sunlight = new THREE.DirectionalLight(0xfff5e5, 3.5);
  sunlight.position.set(-10, 20, 8);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -25;
  sunlight.shadow.camera.right = sunlight.shadow.camera.top = 25;
  sunlight.shadow.normalBias = .03;
  scene.add(sunlight);

  const world = new THREE.Group();
  scene.add(world);
  const structure = new THREE.MeshStandardMaterial({ color: '#f5f7f5', roughness: .8 });
  const dark = new THREE.MeshStandardMaterial({ color: '#435b62', roughness: .8 });
  const pavement = new THREE.MeshStandardMaterial({ color: '#cfdddb', roughness: .95 });
  const road = new THREE.MeshStandardMaterial({ color: '#afc5c6', roughness: 1 });
  const grass = new THREE.MeshStandardMaterial({ color: '#819f85', roughness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: '#b5d8dd', roughness: .3, metalness: .1 });
  const materials: THREE.Material[] = [structure, dark, pavement, road, grass, glass];
  const geometries: THREE.BufferGeometry[] = [];
  const buildings = new Map<DistrictId, Building>();
  const labels = document.createElement('div');
  labels.className = 'world-labels';
  host.append(labels);
  let selected: DistrictId = 'state';
  let viewMode: 'iso' | 'plan' = 'iso';
  let current: View | null = null;

  function box(parent: THREE.Object3D, material: THREE.Material, size: [number, number, number], position: [number, number, number]) {
    const geometry = new THREE.BoxGeometry(...size);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(world, pavement, [26, .32, 18], [1.5, -.35, .4]);
  const grid = new THREE.GridHelper(30, 30, '#c2d1cf', '#d7e0df');
  grid.position.set(1.5, -.53, .4);
  scene.add(grid);

  function windows(parent: THREE.Group, x: number, buildingHeight: number, depth: number, width: number) {
    for (let level = 0; level < 3; level++) {
      box(parent, glass, [width * .72, .12, depth + .016], [x, .55 + buildingHeight * level / 3, 0]);
    }
  }

  function addDistrict(district: District) {
    const group = new THREE.Group();
    group.position.set(district.x, 0, district.z);
    group.userData.id = district.id;
    world.add(group);
    const material = new THREE.MeshStandardMaterial({ color: district.color, emissive: district.color, emissiveIntensity: .02, roughness: .65, metalness: .06 });
    materials.push(material);
    const towers: THREE.Mesh[] = [];
    box(group, structure, [2.65, .2, 2.55], [0, -.04, 0]);
    box(group, material, [2.4, .06, .12], [0, .09, 1.1]);
    if (district.id === 'choice' || district.id === 'score') {
      for (let index = 0; index < 3; index++) {
        const tower = box(group, material, [.52, 1, 1.25], [(index - 1) * .74, .68, 0]);
        towers.push(tower);
        box(group, dark, [.56, .08, 1.29], [(index - 1) * .74, .17, 0]);
      }
    } else if (district.id === 'noul') {
      for (const x of [-.55, .55]) {
        const geometry = new THREE.CylinderGeometry(.39, .48, 1, 16);
        geometries.push(geometry);
        const tower = new THREE.Mesh(geometry, x < 0 ? material : dark);
        tower.position.set(x, .7, 0);
        tower.castShadow = true;
        group.add(tower);
        towers.push(tower);
      }
    } else if (district.id === 'guard' || district.id === 'policy') {
      for (const x of [-.87, .87]) box(group, material, [.32, district.height, .7], [x, district.height / 2 + .15, 0]);
      box(group, material, [2.07, .32, .74], [0, district.height + .15, 0]);
      if (district.id === 'guard') towers.push(box(group, dark, [1.5, .16, .2], [0, .94, .05]));
    } else if (district.id === 'state') {
      for (let layer = 0; layer < 4; layer++) {
        box(group, layer % 2 ? structure : material, [1.5, .28, 1.25], [(layer % 2) * .2 - .1, .3 + layer * .34, 0]);
      }
    } else if (district.id === 'router') {
      box(group, material, [.74, 1.5, 1.35], [-.59, .9, 0]);
      box(group, material, [.74, 2.8, 1.35], [.55, 1.55, 0]);
      windows(group, -.59, 1.5, 1.35, .74);
      windows(group, .55, 2.8, 1.35, .74);
    } else {
      box(group, material, [1.75, district.height, 1.38], [0, district.height / 2 + .15, 0]);
      box(group, structure, [1.89, .12, 1.5], [0, district.height + .22, 0]);
      windows(group, 0, district.height, 1.38, 1.75);
      if (district.id === 'dispatch') box(group, material, [.4, .5, .4], [0, district.height + .47, 0]);
    }
    const ringGeometry = new THREE.RingGeometry(1.5, 1.58, 64);
    geometries.push(ringGeometry);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#163d44', side: THREE.DoubleSide });
    materials.push(ringMaterial);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .13;
    group.add(ring);
    const label = document.createElement('button');
    label.className = 'node-label';
    label.type = 'button';
    label.setAttribute('aria-label', `Inspect ${district.name}`);
    label.style.setProperty('--district-color', district.color);
    label.innerHTML = '<strong></strong><span></span>';
    label.children[0]!.textContent = district.name;
    label.addEventListener('click', () => onSelect(district.id));
    labels.append(label);
    const corners: THREE.Vector3[] = [];
    for (const x of [-1.5, 1.5]) for (const z of [-1.45, 1.45]) for (const y of [0, district.height + .8]) {
      corners.push(new THREE.Vector3(district.x + x, y, district.z + z));
    }
    buildings.set(district.id, { group, material, towers, ring, label, corners, anchor: new THREE.Vector3(district.x, district.height + 1, district.z) });
  }
  districts.forEach(addDistrict);

  for (const [x, z] of [[-10, -6], [2, -6], [2, 5.5], [11.5, 5.4], [-9, 6.5]]) {
    box(world, grass, [1.1, .05, 1.35], [x!, -.13, z!]);
    const geometry = new THREE.ConeGeometry(.38, 1.1, 6);
    geometries.push(geometry);
    const tree = new THREE.Mesh(geometry, grass);
    tree.position.set(x!, .57, z!);
    tree.castShadow = true;
    world.add(tree);
    box(world, dark, [.08, .35, .08], [x!, .03, z!]);
  }

  const connections: [DistrictId, DistrictId][] = [
    ['state', 'dispatch'], ['dispatch', 'choice'], ['dispatch', 'noul'], ['dispatch', 'score'],
    ['choice', 'policy'], ['noul', 'policy'], ['score', 'policy'], ['policy', 'router'],
    ['policy', 'review'], ['router', 'guard'], ['guard', 'tool'], ['guard', 'review'],
  ];
  const streams = connections.map(([from, to]) => {
    const start = districtById(from);
    const end = districtById(to);
    const direction = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
    const street = box(world, road, [direction.length(), .035, .36], [(start.x + end.x) / 2, -.11, (start.z + end.z) / 2]);
    street.rotation.y = -Math.atan2(direction.z, direction.x);
    const curve = new THREE.LineCurve3(new THREE.Vector3(start.x, .32, start.z), new THREE.Vector3(end.x, .32, end.z));
    const material = new THREE.MeshBasicMaterial({ color: end.color });
    materials.push(material);
    const packet = box(world, material, [.2, .2, .2], [start.x, .32, start.z]);
    return { from, to, curve, packet, active: false };
  });

  const scratch = new THREE.Vector3();
  const center = new THREE.Vector3(1.3, .6, .4);
  const groundCorners: THREE.Vector3[] = [];
  for (const x of [-11.5, 14.5]) for (const z of [-8.6, 9.4]) groundCorners.push(new THREE.Vector3(x, -.35, z));
  function frame() {
    if (!host.clientWidth || !host.clientHeight) return;
    camera.position.copy(center).add(viewMode === 'plan' ? new THREE.Vector3(0, 34, .01) : new THREE.Vector3(22, 28, 29));
    controls.target.copy(center);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    const projected = new THREE.Box3();
    for (const building of buildings.values()) for (const corner of building.corners) projected.expandByPoint(scratch.copy(corner).applyMatrix4(camera.matrixWorldInverse));
    for (const corner of groundCorners) projected.expandByPoint(scratch.copy(corner).applyMatrix4(camera.matrixWorldInverse));
    const aspect = host.clientWidth / host.clientHeight;
    const vertical = Math.max(Math.abs(projected.min.y), Math.abs(projected.max.y)) * 2 + 3;
    const horizontal = Math.max(Math.abs(projected.min.x), Math.abs(projected.max.x)) * 2 + 2;
    const extent = Math.max(vertical, horizontal / aspect) * 1.04;
    camera.left = -extent * aspect / 2;
    camera.right = extent * aspect / 2;
    camera.top = extent / 2;
    camera.bottom = -extent / 2;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function select(id: DistrictId) {
    selected = id;
    for (const [key, building] of buildings) {
      building.ring.visible = key === id;
      building.label.dataset.selected = String(key === id);
    }
  }

  function update(view: View) {
    current = view;
    for (const district of districts) {
      const building = buildings.get(district.id)!;
      const active = view.active.includes(district.id);
      building.material.emissiveIntensity = active ? .25 : .02;
      building.label.dataset.active = String(active);
      let label = district.category;
      if (district.id === 'choice') label = view.answersReady ? `${view.triage.department} ${view.triage.probability.toFixed(2)}` : '3 options';
      if (district.id === 'noul') label = view.answersReady ? `p(urgent) ${view.scenario.urgency.toFixed(2)}` : 'true / false';
      if (district.id === 'score') label = view.answersReady ? `${view.triage.severity.toFixed(2)} / 2` : '3 rubric levels';
      if (district.id === 'policy') label = view.tick >= 5 ? (view.triage.destination === 'human_review' ? 'abstain' : 'route accepted') : 'application thresholds';
      if (district.id === 'router') label = view.routeCalls ? view.scenario.modelRoute : 'separate request';
      if (district.id === 'guard') label = view.tick >= 7 ? view.result : 'risk cutoff 0.50';
      if (district.id === 'tool') label = `${view.handlerCalls} fixture calls`;
      if (district.id === 'review') label = view.complete && view.handlerCalls === 0 ? 'no handler call' : 'no automatic action';
      building.label.children[1]!.textContent = label;
      if (['choice', 'score', 'noul'].includes(district.id)) {
        const distribution = district.id === 'choice' ? view.scenario.department : district.id === 'score' ? view.scenario.severity : [view.scenario.urgency, 1 - view.scenario.urgency];
        building.towers.forEach((tower, index) => {
          const size = view.answersReady ? .22 + distribution[index]! * (district.height - .1) : .8;
          tower.scale.y = size;
          tower.position.y = .18 + size / 2;
        });
      }
      if (district.id === 'guard' && building.towers[0]) {
        const barrier = building.towers[0];
        barrier.rotation.z = view.tick >= 7 && (view.result === 'passed' || view.result === 'bypass') ? Math.PI * .4 : 0;
      }
    }
    streams.forEach(stream => {
      const needsReview = view.triage.destination === 'human_review';
      stream.active = (view.phase === 'dispatch' && stream.from === 'state')
        || (view.phase === 'questions' && stream.from === 'dispatch')
        || (['answers', 'policy'].includes(view.phase) && stream.to === 'policy')
        || (view.phase === 'route' && stream.from === 'policy' && stream.to === (needsReview ? 'review' : 'router'))
        || (view.phase === 'gate' && stream.from === 'router' && !needsReview)
        || (view.phase === 'complete' && stream.from === 'guard' && !needsReview && stream.to === (view.handlerCalls ? 'tool' : 'review'));
      stream.packet.visible = stream.active;
    });
    select(selected);
    host.dataset.phase = view.phase;
    host.dataset.nodes = String(buildings.size);
    host.dataset.activeLinks = String(streams.filter(stream => stream.active).length);
  }

  function render(time: number) {
    controls.update();
    camera.updateMatrixWorld();
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    const ordered = [...buildings.entries()].sort(([first], [second]) => Number(second === selected) - Number(first === selected));
    let framed = 0;
    for (const [id, building] of ordered) {
      if (building.corners.every(corner => { scratch.copy(corner).project(camera); return Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1; })) framed++;
      scratch.copy(building.anchor).project(camera);
      const labelWidth = building.label.offsetWidth;
      const labelHeight = building.label.offsetHeight;
      const left = THREE.MathUtils.clamp((scratch.x + 1) * host.clientWidth / 2 - labelWidth / 2, 8, host.clientWidth - labelWidth - 8);
      const top = THREE.MathUtils.clamp((1 - scratch.y) * host.clientHeight / 2 - labelHeight, 62, host.clientHeight - labelHeight - 32);
      const rect = { left: left - 3, right: left + labelWidth + 3, top: top - 3, bottom: top + labelHeight + 3 };
      const overlaps = placed.some(other => rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top);
      building.label.style.visibility = overlaps ? 'hidden' : 'visible';
      building.label.style.left = `${left}px`;
      building.label.style.top = `${top}px`;
      if (!overlaps) placed.push(rect);
      if (current?.active.includes(id)) building.material.emissiveIntensity = .17 + (Math.sin(time * 3) + 1) * .06;
    }
    streams.forEach((stream, index) => { if (stream.active) stream.curve.getPoint((time * .45 + index * .11) % 1, stream.packet.position); });
    renderer.render(scene, camera);
    host.dataset.rendered = 'true';
    host.dataset.framed = String(framed);
    host.dataset.groundFramed = String(groundCorners.every(corner => {
      scratch.copy(corner).project(camera);
      return Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1;
    }));
  }

  const resize = () => { renderer.setSize(host.clientWidth, host.clientHeight, false); frame(); };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let pointerDown = [0, 0];
  renderer.domElement.addEventListener('pointerdown', event => { pointerDown = [event.clientX, event.clientY]; });
  renderer.domElement.addEventListener('click', event => {
    if (Math.hypot(event.clientX - pointerDown[0]!, event.clientY - pointerDown[1]!) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(pointer, camera);
    for (const hit of raycaster.intersectObjects([...buildings.values()].map(building => building.group), true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.id) object = object.parent;
      if (object?.userData.id) { onSelect(object.userData.id as DistrictId); break; }
    }
  });
  select(selected);
  resize();
  return {
    update, render, select, frame,
    setView(value: 'iso' | 'plan') { viewMode = value; host.dataset.camera = value; frame(); },
    zoom(direction: number) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * (direction > 0 ? 1.15 : 1 / 1.15), .6, 2.4); camera.updateProjectionMatrix(); },
    dispose() {
      observer.disconnect(); controls.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      grid.geometry.dispose(); (grid.material as THREE.Material).dispose();
      renderer.dispose(); renderer.domElement.remove(); labels.remove();
    },
  };
}