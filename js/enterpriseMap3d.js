import * as THREE from "../vendor/three/three.module.min.js";

const BUILDINGS = Object.freeze([
  { id:"production", label:"Производственный цех", short:"CHATEAU ALVISA", x:-12.5, z:3.8, width:8.2, depth:5.1, height:2.75 },
  { id:"office", label:"Офис", short:"Управление", x:-1.2, z:-5.2, width:7.2, depth:4.5, height:2.35 },
  { id:"odyssey", label:"Одиссей", short:"Контрактное производство", x:12.6, z:-4.1, width:8.4, depth:5.1, height:2.65 },
]);

const easeInOutCubic = (value) => value < .5
  ? 4 * value ** 3
  : 1 - ((-2 * value + 2) ** 3) / 2;

function box(width, height, depth, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function addRoad(scene, x, z, width, depth, rotation = 0) {
  const road = box(width, .025, depth, new THREE.MeshStandardMaterial({ color:0x30363a, roughness:.92 }));
  road.position.set(x, .035, z);
  road.rotation.y = rotation;
  scene.add(road);
  const stripe = box(width * .88, .012, .035, new THREE.MeshBasicMaterial({ color:0xb99b62, transparent:true, opacity:.52 }));
  stripe.position.set(x, .055, z);
  stripe.rotation.y = rotation;
  scene.add(stripe);
}

function addTree(scene, x, z, scale = 1) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(.07 * scale, .09 * scale, .48 * scale, 6),
    new THREE.MeshStandardMaterial({ color:0x59483d, roughness:1 }),
  );
  trunk.position.set(x, .24 * scale, z);
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(.34 * scale, .85 * scale, 7),
    new THREE.MeshStandardMaterial({ color:0x365448, roughness:.95 }),
  );
  crown.position.set(x, .78 * scale, z);
  scene.add(trunk, crown);
}

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness:.82, emissive:0x000000, ...options });
}

function addWindowRow(group, width, y, z, count, windowWidth = .66) {
  const glass = material(0x273942, { roughness:.25, metalness:.15, emissive:0x10252e, emissiveIntensity:.58 });
  const spacing = (width - 1.2) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    const window = box(windowWidth, .42, .055, glass);
    window.position.set(-width / 2 + .6 + spacing * index, y, z);
    group.add(window);
  }
}

function createIndustrialBuilding(definition) {
  const group = new THREE.Group();
  group.userData = { buildingId:definition.id, definition };
  const lowerHeight = 1.12;
  const green = material(0x276945, { roughness:.72 });
  const white = material(0xd7d9d5, { roughness:.76 });
  const roofMaterial = material(0x343b3e, { roughness:.62, metalness:.22 });
  const lower = box(definition.width, lowerHeight, definition.depth, green);
  lower.position.y = lowerHeight / 2 + .08;
  const upper = box(definition.width, definition.height - lowerHeight, definition.depth, white);
  upper.position.y = lowerHeight + (definition.height - lowerHeight) / 2 + .08;
  const roof = box(definition.width + .2, .16, definition.depth + .2, roofMaterial);
  roof.position.y = definition.height + .16;
  group.add(lower, upper, roof);

  const frontZ = definition.depth / 2 + .032;
  const ribbon = box(definition.width - .8, .38, .06, material(0x17272e, { roughness:.25, emissive:0x0b1c24, emissiveIntensity:.65 }));
  ribbon.position.set(0, 1.67, frontZ);
  group.add(ribbon);
  const bayMaterial = material(0x152329, { roughness:.72 });
  [-2.45, -.82, .82, 2.45].forEach((x) => {
    const bay = box(1.05, .84, .065, bayMaterial);
    bay.position.set(x, .54, frontZ + .01);
    group.add(bay);
  });
  const foundation = box(definition.width + .1, .18, definition.depth + .1, material(0x888c87, { roughness:.95 }));
  foundation.position.y = .09;
  group.add(foundation);

  const ventMaterial = material(0x879095, { roughness:.5, metalness:.52 });
  [-2.3, 0, 2.3].forEach((x) => {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(.18, .23, .55, 12), ventMaterial);
    vent.position.set(x, definition.height + .48, -.25);
    group.add(vent);
  });
  if (definition.id === "odyssey") {
    const accent = box(2.6, .12, .1, material(0x7a1638, { emissive:0x260710, emissiveIntensity:.45 }));
    accent.position.set(0, 2.28, frontZ + .04);
    group.add(accent);
  }

  return finalizeBuilding(group, definition);
}

function createOfficeBuilding(definition) {
  const group = new THREE.Group();
  group.userData = { buildingId:definition.id, definition };
  const brick = material(0xa9582c, { roughness:.9 });
  const stone = material(0xc8b58f, { roughness:.92 });
  const roof = material(0x3a3b39, { roughness:.72 });
  const dark = material(0x202c31, { roughness:.32, emissive:0x10232b, emissiveIntensity:.48 });

  const center = box(3.5, 1.95, 3.65, brick);
  center.position.set(-.25, 1.055, 0);
  const left = box(2.2, 2.2, 3.25, stone);
  left.position.set(-2.65, 1.18, .14);
  const right = box(1.95, 2.35, 3.55, brick);
  right.position.set(2.47, 1.255, -.06);
  const tower = box(1.15, 2.42, 3.7, stone);
  tower.position.set(.9, 1.29, -.02);
  group.add(center, left, right, tower);

  [[-2.65,2.32,2.28,3.35],[-.25,2.02,3.58,3.75],[2.47,2.45,2.02,3.65],[.9,2.54,1.2,3.8]].forEach(([x,y,w,d]) => {
    const cap = box(w, .12, d, roof);
    cap.position.set(x, y, 0);
    group.add(cap);
  });
  addWindowRow(group, 3.15, 1.38, 1.855, 4, .54);
  addWindowRow(group, 3.15, .68, 1.855, 4, .54);
  [-3.2,-2.55,-1.95,1.95,2.55,3.05].forEach((x, index) => {
    const window = box(.42, .54, .055, dark);
    window.position.set(x, index < 3 ? 1.28 : 1.42, 1.83);
    group.add(window);
  });
  const entrance = box(.72, 1.06, .07, dark);
  entrance.position.set(.9, .61, 1.9);
  const canopy = box(1.35, .09, .68, material(0x756c5e, { metalness:.15 }));
  canopy.position.set(.9, 1.18, 2.13);
  group.add(entrance, canopy);

  return finalizeBuilding(group, definition);
}

function finalizeBuilding(group, definition) {

  group.position.set(definition.x, .02, definition.z);
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.userData.buildingRoot = group;
    if (child.material?.emissive) child.userData.baseEmissive = child.material.emissive.getHex();
  });
  return group;
}

function addVinificationArea(scene) {
  const group = new THREE.Group();
  group.position.set(-12.2, 0, -1.25);
  const steel = material(0xb5bdc0, { roughness:.34, metalness:.7 });
  const steelDark = material(0x69757a, { roughness:.44, metalness:.68 });
  const tankXs = [-3.25,-1.95,-.65,.65,1.95,3.25];
  tankXs.forEach((x) => {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(.54,.57,2.55,20), steel);
    tank.position.set(x, 1.32, 0);
    tank.castShadow = true;
    tank.receiveShadow = true;
    group.add(tank);
    [0.42,1.15,1.87,2.54].forEach((y) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.555,.022,6,24), steelDark);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x,y,0);
      group.add(ring);
    });
  });
  const catwalk = box(7.8, .1, .42, steelDark);
  catwalk.position.set(0, 2.72, .05);
  group.add(catwalk);
  tankXs.forEach((x) => {
    const post = box(.035, .48, .035, steelDark);
    post.position.set(x, 3, .05);
    group.add(post);
  });
  const rail = box(7.8, .035, .035, steelDark);
  rail.position.set(0, 3.2, .05);
  group.add(rail);
  scene.add(group);
}

function addOfficeGrounds(scene) {
  const lawn = material(0x365c3f, { roughness:1 });
  [[-4.7,-7.55,3.1,1.15],[1.85,-7.55,3.4,1.15],[-4.75,-3.05,2.75,.9],[1.85,-2.9,3.2,.85]].forEach(([x,z,w,d]) => {
    const patch = box(w,.035,d,lawn);
    patch.position.set(x,.075,z);
    scene.add(patch);
  });
  const gazeboBase = new THREE.Mesh(new THREE.CylinderGeometry(.72,.72,.07,10), material(0xa6a09a));
  gazeboBase.position.set(-5.75,.11,-6.85);
  const gazeboRoof = new THREE.Mesh(new THREE.ConeGeometry(.86,.34,10), material(0x5b3425));
  gazeboRoof.position.set(-5.75,1.05,-6.85);
  scene.add(gazeboBase,gazeboRoof);
  [-6.28,-5.22].forEach((x) => {
    [-7.15,-6.55].forEach((z) => {
      const post = box(.05,.8,.05,material(0x6d503e));
      post.position.set(x,.53,z);
      scene.add(post);
    });
  });
  [[-4.55,-7.1],[-3.6,-7.15],[2.1,-7.1],[3.05,-6.9],[-4.8,-3.2],[2.35,-2.85]].forEach(([x,z], index) => addTree(scene,x,z,.62 + (index % 2) * .12));
}

export function createEnterpriseMap3d({ canvas, labelLayer, onBuildingSelect }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false, powerPreference:"high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080a0b);
  scene.fog = new THREE.Fog(0x080a0b, 38, 67);
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
  const overviewPosition = new THREE.Vector3(0, 25.5, 26.5);
  const overviewTarget = new THREE.Vector3(0, 0, -1.25);
  camera.position.copy(overviewPosition);
  camera.lookAt(overviewTarget);

  scene.add(new THREE.HemisphereLight(0xb8d4e8, 0x17130f, 1.55));
  const sun = new THREE.DirectionalLight(0xffeed4, 2.4);
  sun.position.set(-9, 18, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 23;
  sun.shadow.camera.bottom = -23;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 31),
    new THREE.MeshStandardMaterial({ color:0x19201d, roughness:1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const yard = box(43.5, .04, 20.5, new THREE.MeshStandardMaterial({ color:0x676b69, roughness:1 }));
  yard.position.set(0, .01, -.25);
  yard.receiveShadow = true;
  scene.add(yard);
  addRoad(scene, 0, 7.45, 42.5, 1.2);
  addRoad(scene, -5.2, -.6, 1.15, 15.2, -.12);
  addRoad(scene, 5.35, -.65, 1.15, 15.1, .08);
  addRoad(scene, 0, -8.9, 41.5, 1.05);

  const buildings = new Map();
  BUILDINGS.forEach((definition) => {
    const building = definition.id === "office"
      ? createOfficeBuilding(definition)
      : createIndustrialBuilding(definition);
    buildings.set(definition.id, building);
    scene.add(building);
  });

  addVinificationArea(scene);
  addOfficeGrounds(scene);
  [[-20.5,7.25],[-18.8,7.3],[-17,7.25],[16.8,7.2],[18.6,7.25],[20.3,7.2],[20.5,-8.65],[-20.5,-8.55]].forEach(([x,z], index) => addTree(scene,x,z,.78 + index % 3 * .1));

  const labels = new Map();
  BUILDINGS.forEach((definition) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "map-building-label";
    label.dataset.building = definition.id;
    label.innerHTML = `<strong>${definition.label}</strong><span>${definition.short}</span>`;
    label.addEventListener("click", () => onBuildingSelect?.(definition.id));
    labelLayer.append(label);
    labels.set(definition.id, label);
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(3, 3);
  let hovered = null;
  let active = false;
  let animation = null;
  let frameId = 0;
  let atOverview = true;
  let currentAspect = 1;

  function setHovered(group) {
    if (hovered === group) return;
    if (hovered) {
      hovered.scale.setScalar(1);
      hovered.traverse((child) => {
        if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(child.userData.baseEmissive ?? 0x000000);
      });
      labels.get(hovered.userData.buildingId)?.classList.remove("is-hovered");
    }
    hovered = group;
    canvas.style.cursor = group ? "pointer" : "default";
    if (group) {
      group.scale.setScalar(1.025);
      group.traverse((child) => {
        if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(0x2d2412);
      });
      labels.get(group.userData.buildingId)?.classList.add("is-hovered");
    }
  }

  function updatePointer(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  }

  canvas.addEventListener("pointermove", (event) => {
    if (!active || animation) return;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...buildings.values()], true)[0];
    setHovered(hit?.object?.userData?.buildingRoot || null);
  }, { passive:true });
  canvas.addEventListener("pointerleave", () => setHovered(null));
  canvas.addEventListener("click", (event) => {
    if (!active || animation) return;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...buildings.values()], true)[0];
    const buildingId = hit?.object?.userData?.buildingRoot?.userData?.buildingId;
    if (buildingId) onBuildingSelect?.(buildingId);
  });

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    currentAspect = width / Math.max(height, 1);
    camera.aspect = currentAspect;
    camera.fov = currentAspect < .8 ? 70 : 38;
    scene.fog.near = currentAspect < .8 ? 70 : 38;
    scene.fog.far = currentAspect < .8 ? 116 : 67;
    camera.updateProjectionMatrix();
    const overviewScale = currentAspect < .8 ? 1.72 : currentAspect < 1.15 ? 1.28 : 1;
    overviewPosition.set(0, 25.5 * overviewScale, 26.5 * overviewScale);
    if (atOverview && !animation) {
      camera.position.copy(overviewPosition);
      camera.lookAt(overviewTarget);
    }
  }

  function updateLabels() {
    BUILDINGS.forEach((definition) => {
      const label = labels.get(definition.id);
      const point = new THREE.Vector3(definition.x, definition.height + 1.15, definition.z).project(camera);
      label.style.left = `${(point.x * .5 + .5) * 100}%`;
      label.style.top = `${(-point.y * .5 + .5) * 100}%`;
      label.classList.toggle("is-behind", point.z > 1 || animation !== null);
    });
  }

  function render(timestamp = performance.now()) {
    if (!active) return;
    if (animation) {
      const elapsed = Math.min(1, (timestamp - animation.startedAt) / animation.duration);
      const eased = easeInOutCubic(elapsed);
      camera.position.lerpVectors(animation.fromPosition, animation.toPosition, eased);
      const target = new THREE.Vector3().lerpVectors(animation.fromTarget, animation.toTarget, eased);
      camera.lookAt(target);
      if (elapsed >= 1) {
        const resolve = animation.resolve;
        animation = null;
        resolve();
      }
    }
    updateLabels();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(render);
  }

  function animateCamera(toPosition, toTarget, duration) {
    if (animation) animation.resolve();
    return new Promise((resolve) => {
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      animation = {
        fromPosition:camera.position.clone(),
        fromTarget:camera.position.clone().add(direction.multiplyScalar(10)),
        toPosition:toPosition.clone(),
        toTarget:toTarget.clone(),
        duration,
        startedAt:performance.now(),
        resolve,
      };
    });
  }

  function focusBuilding(buildingId) {
    const building = buildings.get(buildingId);
    if (!building) return Promise.resolve();
    setHovered(null);
    const definition = building.userData.definition;
    const target = new THREE.Vector3(definition.x, definition.height * .55, definition.z);
    const focusScale = currentAspect < .8 ? 1.52 : 1;
    const position = new THREE.Vector3(definition.x, definition.height + 5.6 * focusScale, definition.z + 7.1 * focusScale);
    atOverview = false;
    return animateCamera(position, target, 1450);
  }

  function resetView() {
    atOverview = true;
    return animateCamera(overviewPosition, overviewTarget, 1050);
  }

  function setActive(nextActive) {
    active = Boolean(nextActive);
    if (active) {
      resize();
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(render);
    } else {
      cancelAnimationFrame(frameId);
      setHovered(null);
    }
  }

  window.addEventListener("resize", resize);
  resize();
  renderer.render(scene, camera);
  return { setActive, focusBuilding, resetView, resize };
}
