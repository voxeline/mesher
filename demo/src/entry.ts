declare const require: any;
import THREE = require('three');
window['THREE'] = THREE; // tslint:disable-line no-string-literal
import 'three/examples/js/controls/OrbitControls';
import ndarray = require('ndarray');
const { GUI }: typeof dat = require('dat.gui/build/dat.gui.js');
import BasicMesher from './meshers/BasicMesher';
import AoMesher from './meshers/AoMesher';
import NavMeshMesher from './meshers/NavMeshMesher';
import { fill } from './utils';
import data from './data';

// Setup scene

const scene = new THREE.Scene();
scene.add(new THREE.AxisHelper(30));

const grid0 = new THREE.GridHelper(8, 16);
grid0.geometry.translate(8, 0, 8);
scene.add(grid0);

const grid1 = new THREE.GridHelper(8, 16);
grid1.geometry.translate(8, 0, 8);
grid1.rotation.set(- Math.PI / 2, 0, 0);
scene.add(grid1);

const grid2 = new THREE.GridHelper(8, 16);
grid2.geometry.translate(8, 0, 8);
grid2.rotation.set(0, 0, Math.PI / 2);
scene.add(grid2);

// Setup renderer

const container = document.createElement('div');
container.classList.add('container');
document.body.appendChild(container);

const renderer = new THREE.WebGLRenderer();
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0xcccccc);
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(
  container.clientWidth / - 2,
  container.clientWidth / 2,
  container.clientHeight / 2,
  container.clientHeight / - 2,
  1, 1000
);
camera.position.set(30, 30, 30);
camera.zoom = 10;
camera.updateProjectionMatrix();

window.addEventListener('resize', () => {
  camera.left = container.clientWidth / - 2;
  camera.right = container.clientWidth / 2;
  camera.top = container.clientHeight / 2;
  camera.bottom = container.clientHeight / - 2;

  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

// tslint:disable-next-line:quotemark no-unused-variable
const controls = new THREE.OrbitControls(camera, renderer.domElement);

function render() {
  requestAnimationFrame(render);
  renderer.render(scene, camera);
}
render();

// Add mesh

const MESH_TYPE_BASIC = 'basic';
const MESH_TYPE_AO = 'ao';
const MESH_TYPE_NAVMESH = 'navmesh';

function fillBoundary(array: ndarray) {
  const s = array.shape;
  [
    array.pick(       0 ,       -1 ,       -1),
    array.pick(s[0] - 1 ,       -1 ,       -1),
    array.pick(      -1 ,        0 ,       -1),
    array.pick(      -1 , s[1] - 1 ,       -1),
    array.pick(      -1 ,       -1 ,        0),
    array.pick(      -1 ,       -1 , s[2] - 1),
  ].forEach(c => fill(c, idx => {
    const dx = idx[0] % 4 < 2 ? 1 : -1;
    const dy = idx[1] % 4 < 2 ? 1 : -1;
    return dx * dy > 0 ? 0xF06292 : 0;
  }));
  return array;
}

const makeMeshGetter = (
  mesherClass: typeof BasicMesher | typeof AoMesher | typeof NavMeshMesher
) => (openEnd: boolean, boundaryFilled: boolean) => {
  if (!openEnd) {
    if (!boundaryFilled) {
      const mesher = new mesherClass(false);
      return mesher.build(mesher.pad(data));
    } else {
      const mesher = new mesherClass(false);
      return mesher.build(fillBoundary(mesher.pad(data)));
    }
  } else {
    if (!boundaryFilled) {
      const mesher = new mesherClass(true);
      return mesher.build(mesher.pad(data));
    } else {
      const mesher = new mesherClass(true);
      return mesher.build(fillBoundary(mesher.pad(data)));
    }
  }
};

const getBasicMesh = makeMeshGetter(BasicMesher);
const getAoMesh = makeMeshGetter(AoMesher);
const getNavMesh = makeMeshGetter(NavMeshMesher);

let currentMesh: THREE.Mesh;

const opts = {
  meshType: MESH_TYPE_BASIC,
  openEnd: false,
  fillBoundary: false,
};

function updateMesh() {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh = null;
  }

  switch (opts.meshType) {
    case MESH_TYPE_BASIC: {
      currentMesh = getBasicMesh(opts.openEnd, opts.fillBoundary);
      break;
    }
    case MESH_TYPE_AO: {
      currentMesh = getAoMesh(opts.openEnd, opts.fillBoundary);
      break;
    }
    case MESH_TYPE_NAVMESH: {
      currentMesh = getNavMesh(opts.openEnd, opts.fillBoundary);
      break;
    }
    default: {
      break;
    }
  }

  scene.add(currentMesh);
}

const gui = new GUI();
gui.add(opts, 'meshType', [
  MESH_TYPE_BASIC,
  MESH_TYPE_AO,
  MESH_TYPE_NAVMESH,
]).onChange(updateMesh);
gui.add(opts, 'openEnd').onChange(updateMesh);
gui.add(opts, 'fillBoundary').onChange(updateMesh);

updateMesh();
