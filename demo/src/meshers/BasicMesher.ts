declare const require: any;
import THREE = require('three');
import ndarray = require('ndarray');
import pool = require('typedarray-pool');
const cwise = require('cwise');
import Mesher from '../../../lib/Mesher';

const C_MASK = 0xffffff;

const FLIP_BIT = 1 << 24;

const surfaceStencil = cwise({
  args: [
    'scalar', 'array', 'array', 'array', 'array',
    {offset: [0, 1, 1], array: 3}, {offset: [1, 0, 1], array: 3},
    {offset: [1, 1, 0], array: 3}, {offset: [1, 1, 1], array: 3},
  ],
  body: function (__FLIP_BIT, o0, o1, o2, a, a011, a101, a110, a111) {
    if (a111 && !a011) {
      o0 = a111 | __FLIP_BIT;
    } else if (a011 && !a111) {
      o0 = a011;
    } else {
      o0 = 0;
    }

    if (a111 && !a101) {
      o1 = a111 | __FLIP_BIT;
    } else if (a101 && !a111) {
      o1 = a101;
    } else {
      o1 = 0;
    }

    if (a111 && !a110) {
      o2 = a111 | __FLIP_BIT;
    } else if (a110 && !a111) {
      o2 = a110;
    } else {
      o2 = 0;
    }
  },
}).bind(undefined, FLIP_BIT);

class BasicMesher extends Mesher {
  static material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: THREE.VertexColors,
  });

  private geometry: THREE.Geometry;

  constructor(openEnd: boolean) {
    super({ openEnd });
  }

  build(padded: ndarray) {
    const unpadded = this.unpad(padded);

    const sz = unpadded.shape[0] * unpadded.shape[1] * unpadded.shape[2];
    const scratch0 = pool.mallocInt32(sz);
    const scratch1 = pool.mallocInt32(sz);
    const scratch2 = pool.mallocInt32(sz);
    const ao0 = ndarray(scratch0, unpadded.shape);
    const ao1 = ndarray(scratch1, unpadded.shape);
    const ao2 = ndarray(scratch2, unpadded.shape);

    // Calculate ao fields
    surfaceStencil(ao0, ao1, ao2, unpadded);

    this.geometry = new THREE.Geometry();

    this.computeSurface(0, ao0);
    this.computeSurface(1, ao1);
    this.computeSurface(2, ao2);

    // Release buffers
    pool.freeInt32(scratch0);
    pool.freeInt32(scratch1);
    pool.freeInt32(scratch2);

    const geometry = this.geometry;
    this.geometry = null;

    return new THREE.Mesh(geometry, BasicMesher.material);
  }

  protected append(loX: number, loY: number, hiX: number, hiY: number, val: number) {
    const idx = this.geometry.vertices.length;

    if (val & FLIP_BIT) {
      this.geometry.vertices.push(
        this.createVertex(loX, hiY, this.z),
        this.createVertex(loX, loY, this.z),
        this.createVertex(hiX, hiY, this.z),
        this.createVertex(hiX, loY, this.z),
        this.createVertex(hiX, hiY, this.z),
        this.createVertex(loX, loY, this.z),
      );
    } else {
      this.geometry.vertices.push(
        this.createVertex(loX, loY, this.z),
        this.createVertex(loX, hiY, this.z),
        this.createVertex(hiX, hiY, this.z),
        this.createVertex(hiX, hiY, this.z),
        this.createVertex(hiX, loY, this.z),
        this.createVertex(loX, loY, this.z),
      );
    }

    const face0 = new THREE.Face3(idx    , idx + 1, idx + 2);
    const face1 = new THREE.Face3(idx + 3, idx + 4, idx + 5);

    face0.color.setHex(val & C_MASK);
    face1.color.setHex(val & C_MASK);

    this.geometry.faces.push(face0, face1);
  }

  private createVertex(u: number, v: number, d: number) {
    const vertex = new THREE.Vector3();
    vertex.setComponent(this.u, u);
    vertex.setComponent(this.v, v);
    vertex.setComponent(this.d, d);
    return vertex;
  }
}

export default BasicMesher;
