declare const require: any;
import THREE = require('three');
import ndarray = require('ndarray');
import pool = require('typedarray-pool');
const cwise = require('cwise');
import Mesher from '../../../lib/Mesher';

const FLIP_BIT = 1 << 24;

const surfaceStencil = cwise({
  args: [
    'array', 'array',
    {offset: [1, 0, 1], array: 1}, {offset: [1, 1, 1], array: 1},
  ],
  body: function (o1, a, a101, a111) {
    o1 = a101 && !a111;
  },
});

class NavMeshMesher extends Mesher {
  static material = new THREE.MeshBasicMaterial({ color: 0x4CAF50 });

  private geometry: THREE.Geometry;

  constructor(openEnd: boolean) {
    super({ openEnd });
  }

  build(padded: ndarray) {
    const unpadded = this.unpad(padded);

    const sz = unpadded.shape[0] * unpadded.shape[1] * unpadded.shape[2];
    const scratch1 = pool.mallocInt32(sz);
    const ao1 = ndarray(scratch1, unpadded.shape);

    // Calculate ao fields
    surfaceStencil(ao1, unpadded);

    this.geometry = new THREE.Geometry();

    this.computeSurface(1, ao1);

    // Release buffers
    pool.freeInt32(scratch1);

    const geometry = this.geometry;
    this.geometry = null;

    return new THREE.Mesh(geometry, NavMeshMesher.material);
  }

  protected append(loX: number, loY: number, hiX: number, hiY: number, val: number) {
    const idx = this.geometry.vertices.length;

    if (val & FLIP_BIT) {
      this.geometry.vertices.push(
        this.createVertex(loX, loY, this.z),
        this.createVertex(hiX, loY, this.z),
        this.createVertex(loX, hiY, this.z),
        this.createVertex(hiX, hiY, this.z),
        this.createVertex(loX, hiY, this.z),
        this.createVertex(hiX, loY, this.z),
      );
    } else {
      this.geometry.vertices.push(
        this.createVertex(loX, loY, this.z),
        this.createVertex(loX, hiY, this.z),
        this.createVertex(hiX, loY, this.z),
        this.createVertex(hiX, hiY, this.z),
        this.createVertex(hiX, loY, this.z),
        this.createVertex(loX, hiY, this.z),
      );
    }

    const face0 = new THREE.Face3(idx    , idx + 1, idx + 2);
    const face1 = new THREE.Face3(idx + 3, idx + 4, idx + 5);

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

export default NavMeshMesher;
