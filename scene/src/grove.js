import * as THREE from 'three';
import { islandHeight } from '../vendor/ultra-water/src/scene/islandHeight.js';
import { fbm } from '../vendor/ultra-water/src/scene/noise.js';

// One shared geometry per plant part; all vegetation is static and instanced.
// The seed keeps the grove identical across launches and camera resets.
export function createGrove(reflectionLayer = 1) {
  let seed = 17429;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const group = new THREE.Group();
  group.name = 'Island grove';
  const transform = new THREE.Object3D();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const origin = new THREE.Vector3();
  const local = new THREE.Vector3();
  const shade = new THREE.Color();

  function instances(geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.enable(reflectionLayer);
    group.add(mesh);
    return mesh;
  }

  function place(mesh, index, position, yaw, sx, sy = sx, sz = sx) {
    transform.position.copy(position);
    transform.rotation.set(0, yaw, 0);
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }

  function sites(count, minHeight, maxHeight, separation, maxSlope = 0.6, clustered = false) {
    const points = [];
    for (let tries = 0; points.length < count && tries < 24000; tries++) {
      const x = (random() - 0.5) * 760;
      const z = (random() - 0.5) * 760;
      const y = islandHeight(x, z);
      if (y < minHeight || y > maxHeight) continue;
      if (clustered && random() > 0.55 + fbm(x * 0.016, z * 0.016, 3, 42) * 0.8) continue;
      const slope =
        Math.hypot(
          islandHeight(x + 2, z) - islandHeight(x - 2, z),
          islandHeight(x, z + 2) - islandHeight(x, z - 2),
        ) / 4;
      if (slope > maxSlope || points.some((p) => Math.hypot(p.x - x, p.z - z) < separation))
        continue;
      points.push(new THREE.Vector3(x, y - 0.35, z));
    }
    return points;
  }

  const bark = new THREE.MeshStandardMaterial({ color: 0x8d7453, roughness: 0.95 });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x649e46,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x4f8c43, roughness: 0.95 });

  // A gentle lean is part of the trunk geometry, shared by every palm.
  const trunkGeometry = new THREE.CylinderGeometry(0.48, 0.85, 20, 7, 9);
  const trunkPositions = trunkGeometry.attributes.position;
  for (let i = 0; i < trunkPositions.count; i++) {
    const y = trunkPositions.getY(i) + 10;
    trunkPositions.setXYZ(i, trunkPositions.getX(i) + 3 * (y / 20) ** 2, y, trunkPositions.getZ(i));
  }
  trunkGeometry.computeVertexNormals();

  // Feathered fronds: a narrow curved spine and separate pointed leaflets.
  // Real geometry gives a clean silhouette without alpha textures or downloads.
  const vertices = [];
  const bend = (x) => 2.6 * Math.sin((Math.PI * x) / 12) - 0.15 * x;
  function triangle(a, b, c) {
    vertices.push(...a, ...b, ...c);
  }
  for (let i = 0; i < 14; i++) {
    const x = (i * 12) / 14;
    const next = ((i + 1) * 12) / 14;
    const width = 2.8 * Math.sin((Math.PI * (i + 1)) / 15);
    triangle([x, bend(x), -0.1], [next, bend(next), -0.06], [next, bend(next), 0.06]);
    triangle([x, bend(x), -0.1], [next, bend(next), 0.06], [x, bend(x), 0.1]);
    for (const side of [-1, 1]) {
      triangle(
        [x, bend(x), 0],
        [x + 1.65, bend(x) - width * 0.28, side * width],
        [next, bend(next), side * 0.08],
      );
    }
  }
  const frondGeometry = new THREE.BufferGeometry();
  frondGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  frondGeometry.computeVertexNormals();

  const palms = sites(42, 1.8, 14, 21);
  const trunks = instances(trunkGeometry, bark, palms.length);
  const fronds = instances(frondGeometry, leafMaterial, palms.length * 8);
  palms.forEach((position, i) => {
    const scale = 0.8 + random() * 0.45;
    const yaw = random() * Math.PI * 2;
    place(trunks, i, position, yaw, scale);
    rotation.setFromAxisAngle(up, yaw);
    origin.copy(position).add(local.set(3 * scale, 20 * scale, 0).applyQuaternion(rotation));
    for (let j = 0; j < 8; j++) {
      const length = scale * (0.82 + random() * 0.3);
      place(fronds, i * 8 + j, origin, yaw + (j * Math.PI) / 4 + random() * 0.2, length);
      fronds.setColorAt(
        i * 8 + j,
        shade.setHSL(0.25 + random() * 0.035, 0.35, 0.66 + random() * 0.15),
      );
    }
  });

  // Dense overlapping crowns follow the hills, with noise-shaped clearings.
  // Keep the beach open so the individual palms retain their silhouettes.
  const trees = sites(520, 7, 90, 10, 1.8, true);
  const stemGeometry = new THREE.CylinderGeometry(0.5, 0.9, 1, 6);
  stemGeometry.translate(0, 0.5, 0);
  const stems = instances(stemGeometry, bark, trees.length);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 2);
  const crownPositions = crownGeometry.attributes.position;
  for (let i = 0; i < crownPositions.count; i++) {
    const x = crownPositions.getX(i),
      y = crownPositions.getY(i),
      z = crownPositions.getZ(i);
    const lobe = 1 + 0.13 * Math.sin(x * 9 + y * 5) * Math.cos(z * 8 - y * 3);
    crownPositions.setXYZ(i, x * lobe, y * lobe, z * lobe);
  }
  crownGeometry.computeVertexNormals();
  const crowns = instances(crownGeometry, crownMaterial, trees.length * 2);
  trees.forEach((position, i) => {
    const height = 10 + random() * 12;
    const width = 9 + random() * 7;
    const yaw = random() * Math.PI * 2;
    place(stems, i, position, yaw, 1, height, 1);
    for (let j = 0; j < 2; j++) {
      origin
        .copy(position)
        .add(local.set(j ? width * 0.5 : 0, height + j * 2, j ? width * 0.15 : 0));
      place(crowns, i * 2 + j, origin, yaw, width * (j ? 0.72 : 1), width * 0.7, width * 0.85);
      crowns.setColorAt(
        i * 2 + j,
        shade.setHSL(0.25 + random() * 0.06, 0.25, 0.56 + random() * 0.24),
      );
    }
  });
  for (const mesh of group.children) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  return { group, treePositions: trees, canopies: crowns };
}
