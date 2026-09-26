import * as THREE from "../vendor/three/three.module.min.js";

const BUILDINGS = Object.freeze([
  { id:"production", label:"Производственный цех", short:"CHATEAU ALVISA", x:-12.5, z:3.8, width:8.2, depth:5.1, height:2.75 },
  { id:"office", label:"Офис", short:"Управление", x:-1.2, z:-5.2, width:7.2, depth:4.5, height:2.35 },
  { id:"odyssey", label:"Одиссей", short:"Контрактное производство", x:12.6, z:-4.1, width:8.4, depth:5.1, height:2.65 },
]);

const PRODUCTION_AREAS = Object.freeze([
  { id:"bottling", departmentKey:"bottling", label:"Цех розлива", short:"Первый этаж", x:-1.15, z:.15, width:9.6, depth:3.25, color:0x275e75 },
  { id:"components", departmentKey:"warehouse", label:"Склад комплектующих", short:"Подразделение СГП", x:-3.45, z:-3.45, width:5, depth:2.9, color:0x6d522b },
  { id:"blending", departmentKey:"blending", label:"Купажный цех", short:"Производственное помещение", x:2.55, z:-3.45, width:6.1, depth:2.9, color:0x5d3c63 },
  { id:"warehouse", departmentKey:"warehouse", label:"Склад готовой продукции", short:"Первый этаж", x:-1.05, z:4.05, width:12, depth:3.3, color:0x3f6244 },
]);

const PRODUCTION_LANDMARKS = Object.freeze([
  { id:"rear-yard", label:"Задний двор", x:-7.95, z:.2 },
  { id:"entrance", label:"Вход", x:7.35, z:.95 },
  { id:"stairs", label:"Лестница на 2 этаж", x:6.75, z:-.8, levelId:"production-second" },
]);

const SECOND_FLOOR_AREAS = Object.freeze([
  { id:"egais", departmentKey:"egais", label:"Кабинет ЕГАИС", short:"Второй этаж", x:1.7, z:-2.35, width:2.25, depth:1.35, color:0x255f72 },
]);

const easeInOutCubic = (value) => value < .5
  ? 4 * value ** 3
  : 1 - ((-2 * value + 2) ** 3) / 2;

const STAFFING_EMISSIVE = Object.freeze({
  staffed:0x17633f,
  minimum:0x795616,
  empty:0x7a1832,
});

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

function createSwitchbackStairs() {
  const group = new THREE.Group();
  const stepMaterial = material(0x8d918d,{ roughness:.76 });
  const landingMaterial = material(0x737a7b,{ roughness:.72 });
  const railMaterial = material(0x606a6d,{ roughness:.48,metalness:.52 });
  const stepCount = 6;
  for (let index = 0; index < stepCount; index += 1) {
    const lowerStep = box(.34,.08,.46,stepMaterial);
    lowerStep.position.set(-.92 + index * .32,.1 + index * .085,-.34);
    group.add(lowerStep);
    const upperStep = box(.34,.08,.46,stepMaterial);
    upperStep.position.set(.68 - index * .32,.64 + index * .085,.34);
    group.add(upperStep);
  }
  const landing = box(.58,.1,1.16,landingMaterial);
  landing.position.set(1.03,.58,0);
  group.add(landing);
  [-.62,.62].forEach((z) => {
    const rail = box(2.35,.05,.05,railMaterial);
    rail.position.set(-.03,.83,z);
    group.add(rail);
  });
  const turnRail = box(.05,.48,1.18,railMaterial);
  turnRail.position.set(1.32,.84,0);
  group.add(turnRail);
  return group;
}

function createProductionInterior() {
  const group = new THREE.Group();
  group.visible = false;
  const shell = material(0x2a3032, { roughness:.95 });
  const wall = material(0xd3d0c5, { roughness:.9 });
  const corridor = material(0x777b76, { roughness:.96 });
  const doorMaterial = material(0x21343d, { roughness:.55, emissive:0x09151a, emissiveIntensity:.35 });
  const areas = new Map();
  const levelTargets = new Map();

  const foundation = box(18.2,.12,11.8,shell);
  foundation.position.set(0,.02,.35);
  foundation.receiveShadow = true;
  group.add(foundation);

  PRODUCTION_AREAS.forEach((definition) => {
    const area = new THREE.Group();
    area.userData = { areaId:definition.id, definition };
    const floor = box(definition.width,.16,definition.depth,material(definition.color,{ roughness:.82 }));
    floor.position.y = .13;
    area.add(floor);
    const outlineMaterial = material(0xc7c2b5,{ roughness:.86 });
    const north = box(definition.width,.42,.1,outlineMaterial);
    const south = box(definition.width,.42,.1,outlineMaterial);
    const west = box(.1,.42,definition.depth,outlineMaterial);
    const east = box(.1,.42,definition.depth,outlineMaterial);
    north.position.set(0,.32,-definition.depth / 2);
    south.position.set(0,.32,definition.depth / 2);
    west.position.set(-definition.width / 2,.32,0);
    east.position.set(definition.width / 2,.32,0);
    area.add(north,south,west,east);
    area.position.set(definition.x,0,definition.z);
    area.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.areaRoot = area;
      if (child.material?.emissive) child.userData.baseEmissive = child.material.emissive.getHex();
    });
    areas.set(definition.id,area);
    group.add(area);
  });

  const crossCorridor = box(1.05,.13,3.25,corridor);
  crossCorridor.position.set(5.0,.12,.15);
  const entryCorridor = box(2.4,.13,.9,corridor);
  entryCorridor.position.set(6.68,.12,.95);
  const stairCorridor = box(2.4,.13,.9,corridor);
  stairCorridor.position.set(6.68,.12,-.8);
  const rearYard = box(1.8,.1,10.3,material(0x38463c,{ roughness:1 }));
  rearYard.position.set(-7.95,.09,.2);
  group.add(crossCorridor,entryCorridor,stairCorridor,rearYard);

  const entranceLanding = box(1.2,.18,.85,material(0x7f817b));
  entranceLanding.position.set(8.35,.16,.95);
  group.add(entranceLanding);
  [0,.26,.52].forEach((offset,index) => {
    const step = box(1.15 - index * .12,.08,.22,material(0x96958e));
    step.position.set(8.75 + offset,.06 + index * .07,.95);
    group.add(step);
  });
  [-.22,.22].forEach((zOffset) => {
    const door = box(.08,.75,.34,doorMaterial);
    door.position.set(7.75,.48,.95 + zOffset);
    group.add(door);
  });

  const stairs = new THREE.Group();
  stairs.userData = { levelId:"production-second" };
  const stairModel = createSwitchbackStairs();
  stairModel.position.set(6.5,0,-.8);
  stairs.add(stairModel);
  stairs.traverse((child) => {
    if (!child.isMesh) return;
    child.userData.levelRoot = stairs;
    if (child.material?.emissive) child.userData.baseEmissive = child.material.emissive.getHex();
  });
  levelTargets.set("production-second",stairs);
  group.add(stairs);

  const bottlingDoor = box(.1,.72,.72,doorMaterial);
  bottlingDoor.position.set(4.42,.48,-1.12);
  group.add(bottlingDoor);
  const componentsDoor = box(.8,.72,.1,doorMaterial);
  componentsDoor.position.set(-2.4,.48,-1.86);
  const blendingDoor = box(.8,.72,.1,doorMaterial);
  blendingDoor.position.set(1.5,.48,-1.86);
  group.add(componentsDoor,blendingDoor);
  [-4.7,-1.7,1.3,4.3].forEach((x) => {
    const door = box(.9,.72,.1,doorMaterial);
    door.position.set(x,.48,2.36);
    group.add(door);
    const line = box(.1,.08,2.55,material(0xb2a066,{ emissive:0x31250c,emissiveIntensity:.2 }));
    line.position.set(x,.24,.95);
    group.add(line);
  });

  return { group, areas, levelTargets };
}

function createProductionSecondFloor() {
  const group = new THREE.Group();
  group.visible = false;
  const areas = new Map();
  const floorMaterial = material(0x626762,{ roughness:.96 });
  const wallMaterial = material(0xd1cec3,{ roughness:.91 });
  const roomMaterial = material(0x343b3e,{ roughness:.9 });
  const doorMaterial = material(0x26383f,{ roughness:.58,emissive:0x0a171b,emissiveIntensity:.34 });

  const base = box(8.2,.12,14.3,material(0x24292a,{ roughness:1 }));
  base.position.y = .02;
  const corridor = box(2.15,.15,12.6,floorMaterial);
  corridor.position.set(0,.13,0);
  const landing = box(3.2,.15,1.8,floorMaterial);
  landing.position.set(2.55,.13,0);
  const balcony = box(1.15,.12,12.6,material(0x3d4a43,{ roughness:.96 }));
  balcony.position.set(-2.05,.11,0);
  group.add(base,corridor,landing,balcony);

  const westWall = box(.12,.46,12.8,wallMaterial);
  westWall.position.set(-1.12,.34,0);
  const eastWall = box(.12,.46,12.8,wallMaterial);
  eastWall.position.set(1.12,.34,0);
  group.add(westWall,eastWall);

  const stairGroup = createSwitchbackStairs();
  stairGroup.position.set(2.35,0,0);
  group.add(stairGroup);

  const rooms = [
    { x:2.15,z:-5.35,w:1.85,d:1.65 },
    { x:2.15,z:-4.0,w:1.85,d:.85 },
    { x:2.15,z:-3.08,w:1.85,d:.75 },
    { x:2.15,z:-1.0,w:1.85,d:1.25 },
    { x:2.15,z:1.45,w:1.85,d:1.35 },
    { x:2.15,z:3.05,w:1.85,d:1.25 },
    { x:2.15,z:4.62,w:1.85,d:1.35 },
    { x:2.15,z:5.75,w:1.85,d:.8 },
  ];
  rooms.forEach((room) => {
    const block = box(room.w,.2,room.d,roomMaterial);
    block.position.set(room.x,.17,room.z);
    group.add(block);
    const door = box(.62,.7,.09,doorMaterial);
    door.position.set(1.18,.47,room.z);
    group.add(door);
  });
  const balconyDoor = box(.09,.72,.68,doorMaterial);
  balconyDoor.position.set(-1.15,.48,-.85);
  group.add(balconyDoor);

  SECOND_FLOOR_AREAS.forEach((definition) => {
    const area = new THREE.Group();
    area.userData = { areaId:definition.id, definition };
    const room = box(definition.width,.22,definition.depth,material(definition.color,{ roughness:.8 }));
    room.position.y = .18;
    area.add(room);
    const door = box(.62,.72,.09,doorMaterial.clone());
    door.position.set(-definition.width / 2 - .03,.49,0);
    area.add(door);
    area.position.set(definition.x,0,definition.z);
    area.traverse((child) => {
      if (!child.isMesh) return;
      child.userData.areaRoot = area;
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material?.emissive) child.userData.baseEmissive = child.material.emissive.getHex();
    });
    areas.set(definition.id,area);
    group.add(area);
  });

  return { group, areas };
}

export function createEnterpriseMap3d({ canvas, labelLayer, onBuildingSelect, onDepartmentSelect, onLevelSelect }) {
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

  const exteriorGroup = new THREE.Group();
  scene.add(exteriorGroup);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 31),
    new THREE.MeshStandardMaterial({ color:0x19201d, roughness:1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  exteriorGroup.add(ground);

  const yard = box(43.5, .04, 20.5, new THREE.MeshStandardMaterial({ color:0x676b69, roughness:1 }));
  yard.position.set(0, .01, -.25);
  yard.receiveShadow = true;
  exteriorGroup.add(yard);
  addRoad(exteriorGroup, 0, 7.45, 42.5, 1.2);
  addRoad(exteriorGroup, -5.2, -.6, 1.15, 15.2, -.12);
  addRoad(exteriorGroup, 5.35, -.65, 1.15, 15.1, .08);
  addRoad(exteriorGroup, 0, -8.9, 41.5, 1.05);

  const buildings = new Map();
  BUILDINGS.forEach((definition) => {
    const building = definition.id === "office"
      ? createOfficeBuilding(definition)
      : createIndustrialBuilding(definition);
    buildings.set(definition.id, building);
    exteriorGroup.add(building);
  });

  addVinificationArea(exteriorGroup);
  addOfficeGrounds(exteriorGroup);
  [[-20.5,7.25],[-18.8,7.3],[-17,7.25],[16.8,7.2],[18.6,7.25],[20.3,7.2],[20.5,-8.65],[-20.5,-8.55]].forEach(([x,z], index) => addTree(exteriorGroup,x,z,.78 + index % 3 * .1));

  const productionInterior = createProductionInterior();
  scene.add(productionInterior.group);
  const productionSecondFloor = createProductionSecondFloor();
  scene.add(productionSecondFloor.group);

  const labels = new Map();
  BUILDINGS.forEach((definition) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "map-building-label";
    label.dataset.building = definition.id;
    label.innerHTML = `<strong>${definition.label}</strong><span>${definition.short}</span><em data-staffing-label>Нет данных</em>`;
    label.addEventListener("click", () => onBuildingSelect?.(definition.id));
    labelLayer.append(label);
    labels.set(definition.id, label);
  });
  const areaLabels = new Map();
  PRODUCTION_AREAS.forEach((definition) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "map-building-label map-department-label is-behind";
    label.dataset.department = definition.id;
    label.innerHTML = `<strong>${definition.label}</strong><span>${definition.short}</span><em data-staffing-label>Нет данных</em>`;
    label.addEventListener("click", () => onDepartmentSelect?.(definition.id, definition.departmentKey));
    labelLayer.append(label);
    areaLabels.set(definition.id,label);
  });
  const landmarkLabels = new Map();
  PRODUCTION_LANDMARKS.forEach((definition) => {
    const label = document.createElement(definition.levelId ? "button" : "div");
    label.className = "map-landmark-label is-behind";
    label.textContent = definition.label;
    if (definition.levelId) {
      label.type = "button";
      label.classList.add("is-interactive");
      label.addEventListener("click", () => onLevelSelect?.(definition.levelId));
    }
    labelLayer.append(label);
    landmarkLabels.set(definition.id,label);
  });
  const secondFloorLabels = new Map();
  SECOND_FLOOR_AREAS.forEach((definition) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "map-building-label map-department-label is-behind";
    label.dataset.department = definition.id;
    label.innerHTML = `<strong>${definition.label}</strong><span>${definition.short}</span><em data-staffing-label>Нет данных</em>`;
    label.addEventListener("click", () => onDepartmentSelect?.(definition.id,definition.departmentKey));
    labelLayer.append(label);
    secondFloorLabels.set(definition.id,label);
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(3, 3);
  let hovered = null;
  let active = false;
  let animation = null;
  let frameId = 0;
  let atOverview = true;
  let currentAspect = 1;
  let viewMode = "exterior";

  function productionPoint(x, y, z) {
    productionInterior.group.updateMatrixWorld(true);
    return productionInterior.group.localToWorld(new THREE.Vector3(x,y,z));
  }

  function secondFloorPoint(x, y, z) {
    productionSecondFloor.group.updateMatrixWorld(true);
    return productionSecondFloor.group.localToWorld(new THREE.Vector3(x,y,z));
  }

  function interiorCameraScale() {
    if (currentAspect < .8) return viewMode === "production-second" ? .82 : 1.05;
    return currentAspect < 1.15 ? 1.28 : 1;
  }

  function labelFor(group) {
    if (!group) return null;
    if (group.userData.levelId) {
      const landmark = PRODUCTION_LANDMARKS.find((item) => item.levelId === group.userData.levelId);
      return landmark ? landmarkLabels.get(landmark.id) : null;
    }
    return group.userData.areaId
      ? (viewMode === "production-second" ? secondFloorLabels : areaLabels).get(group.userData.areaId)
      : labels.get(group.userData.buildingId);
  }

  function interactiveTargets() {
    if (viewMode === "production") {
      return [...productionInterior.areas.values(),...productionInterior.levelTargets.values()];
    }
    if (viewMode === "production-second") return [...productionSecondFloor.areas.values()];
    return [...buildings.values()];
  }

  function interactionRoot(hit) {
    return hit?.object?.userData?.areaRoot
      || hit?.object?.userData?.levelRoot
      || hit?.object?.userData?.buildingRoot
      || null;
  }

  function setHovered(group) {
    if (hovered === group) return;
    if (hovered) {
      hovered.scale.setScalar(1);
      hovered.traverse((child) => {
        if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(child.userData.staffingEmissive ?? child.userData.baseEmissive ?? 0x000000);
      });
      labelFor(hovered)?.classList.remove("is-hovered");
    }
    hovered = group;
    canvas.style.cursor = group ? "pointer" : "default";
    if (group) {
      group.scale.setScalar(1.025);
      group.traverse((child) => {
        if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(0x2d2412);
      });
      labelFor(group)?.classList.add("is-hovered");
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
    const targets = interactiveTargets();
    const hit = raycaster.intersectObjects(targets, true)[0];
    setHovered(interactionRoot(hit));
  }, { passive:true });
  canvas.addEventListener("pointerleave", () => setHovered(null));
  canvas.addEventListener("click", (event) => {
    if (!active || animation) return;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    if (viewMode === "production" || viewMode === "production-second") {
      const hit = raycaster.intersectObjects(interactiveTargets(), true)[0];
      const root = interactionRoot(hit);
      if (root?.userData?.levelId) {
        onLevelSelect?.(root.userData.levelId);
        return;
      }
      const definition = root?.userData?.definition;
      if (definition) onDepartmentSelect?.(definition.id, definition.departmentKey);
      return;
    }
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
    const portraitRotation = currentAspect < .8 ? Math.PI / 2 : 0;
    productionInterior.group.rotation.y = portraitRotation;
    productionInterior.group.updateMatrixWorld(true);
    productionSecondFloor.group.rotation.y = 0;
    productionSecondFloor.group.updateMatrixWorld(true);
    if (viewMode === "production" || viewMode === "production-second") {
      const interiorScale = interiorCameraScale();
      if (!animation) {
        camera.position.set(0,18 * interiorScale,16 * interiorScale);
        camera.lookAt(0,0,.3);
      }
    } else {
      const overviewScale = currentAspect < .8 ? 1.72 : currentAspect < 1.15 ? 1.28 : 1;
      overviewPosition.set(0,25.5 * overviewScale,26.5 * overviewScale);
      if (atOverview && !animation) {
        camera.position.copy(overviewPosition);
        camera.lookAt(overviewTarget);
      }
    }
  }

  function updateLabels() {
    BUILDINGS.forEach((definition) => {
      const label = labels.get(definition.id);
      const point = new THREE.Vector3(definition.x, definition.height + 1.15, definition.z).project(camera);
      label.style.left = `${(point.x * .5 + .5) * 100}%`;
      label.style.top = `${(-point.y * .5 + .5) * 100}%`;
      label.classList.toggle("is-behind", viewMode !== "exterior" || point.z > 1 || animation !== null);
    });
    PRODUCTION_AREAS.forEach((definition) => {
      const label = areaLabels.get(definition.id);
      const point = productionPoint(definition.x,.78,definition.z).project(camera);
      label.style.left = `${(point.x * .5 + .5) * 100}%`;
      label.style.top = `${(-point.y * .5 + .5) * 100}%`;
      label.classList.toggle("is-behind", viewMode !== "production" || point.z > 1 || animation !== null);
    });
    PRODUCTION_LANDMARKS.forEach((definition) => {
      const label = landmarkLabels.get(definition.id);
      const point = productionPoint(definition.x,.65,definition.z).project(camera);
      label.style.left = `${(point.x * .5 + .5) * 100}%`;
      label.style.top = `${(-point.y * .5 + .5) * 100}%`;
      label.classList.toggle("is-behind", viewMode !== "production" || point.z > 1 || animation !== null);
    });
    SECOND_FLOOR_AREAS.forEach((definition) => {
      const label = secondFloorLabels.get(definition.id);
      const point = secondFloorPoint(definition.x,.78,definition.z).project(camera);
      label.style.left = `${(point.x * .5 + .5) * 100}%`;
      label.style.top = `${(-point.y * .5 + .5) * 100}%`;
      label.classList.toggle("is-behind", viewMode !== "production-second" || point.z > 1 || animation !== null);
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
    viewMode = "exterior";
    exteriorGroup.visible = true;
    productionInterior.group.visible = false;
    productionSecondFloor.group.visible = false;
    setHovered(null);
    atOverview = true;
    return animateCamera(overviewPosition, overviewTarget, 1050);
  }

  function enterProductionInterior() {
    setHovered(null);
    viewMode = "production";
    exteriorGroup.visible = false;
    productionInterior.group.visible = true;
    productionSecondFloor.group.visible = false;
    atOverview = false;
    const scale = interiorCameraScale();
    camera.position.set(0,18 * scale,16 * scale);
    camera.lookAt(0,0,.3);
    return Promise.resolve();
  }

  function resetProductionInterior() {
    if (viewMode !== "production" && viewMode !== "production-second") return Promise.resolve();
    setHovered(null);
    const scale = interiorCameraScale();
    return animateCamera(new THREE.Vector3(0,18 * scale,16 * scale),new THREE.Vector3(0,0,.3),700);
  }

  function enterProductionSecondFloor() {
    setHovered(null);
    viewMode = "production-second";
    exteriorGroup.visible = false;
    productionInterior.group.visible = false;
    productionSecondFloor.group.visible = true;
    const scale = interiorCameraScale();
    camera.position.set(0,18 * scale,16 * scale);
    camera.lookAt(0,0,.3);
    return Promise.resolve();
  }

  function focusDepartment(areaId) {
    const area = viewMode === "production-second"
      ? productionSecondFloor.areas.get(areaId)
      : productionInterior.areas.get(areaId);
    if (!area) return Promise.resolve();
    setHovered(null);
    const definition = area.userData.definition;
    const scale = currentAspect < .8 ? 1.45 : 1;
    const target = viewMode === "production-second"
      ? secondFloorPoint(definition.x,0,definition.z)
      : productionPoint(definition.x,0,definition.z);
    return animateCamera(
      target.clone().add(new THREE.Vector3(0,6.2 * scale,5.2 * scale)),
      target,
      950,
    );
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

  function applyGroupStaffing(group, state, enabled) {
    const staffingColor = enabled ? STAFFING_EMISSIVE[state?.status] : null;
    group?.traverse((child) => {
      if (!child.isMesh || !child.material?.emissive) return;
      if (child.userData.baseEmissiveIntensity == null) {
        child.userData.baseEmissiveIntensity = child.material.emissiveIntensity;
      }
      child.userData.staffingEmissive = staffingColor ?? child.userData.baseEmissive ?? 0x000000;
      child.material.emissive.setHex(child.userData.staffingEmissive);
      child.material.emissiveIntensity = staffingColor ? .72 : child.userData.baseEmissiveIntensity;
    });
  }

  function applyLabelStaffing(label, state) {
    if (!label) return;
    label.dataset.staffing = state?.status || "unknown";
    const detail = label.querySelector("[data-staffing-label]");
    if (detail) detail.textContent = !state || state.status === "unknown"
      ? "Нет данных"
      : `${state.count} на смене · ${state.label}`;
  }

  function setStaffingState(state = {}, enabled = false) {
    BUILDINGS.forEach((definition) => {
      const item = state?.buildings?.[definition.id];
      applyGroupStaffing(buildings.get(definition.id), item, enabled);
      applyLabelStaffing(labels.get(definition.id), item);
    });
    PRODUCTION_AREAS.forEach((definition) => {
      const item = state?.departments?.[definition.departmentKey];
      applyGroupStaffing(productionInterior.areas.get(definition.id), item, enabled);
      applyLabelStaffing(areaLabels.get(definition.id), item);
    });
    SECOND_FLOOR_AREAS.forEach((definition) => {
      const item = state?.departments?.[definition.departmentKey];
      applyGroupStaffing(productionSecondFloor.areas.get(definition.id), item, enabled);
      applyLabelStaffing(secondFloorLabels.get(definition.id), item);
    });
  }

  window.addEventListener("resize", resize);
  resize();
  renderer.render(scene, camera);
  return { setActive, setStaffingState, focusBuilding, focusDepartment, enterProductionInterior, enterProductionSecondFloor, resetProductionInterior, resetView, resize };
}
