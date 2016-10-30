declare const require: any;

import ndarray = require('ndarray');
import assign from 'ndarray-ops-typed/lib/assign';
import map from 'ndarray-ops-typed/lib/map';
const compileMesher = require('greedy-mesher');

export interface MesherOptions {
  margin?: number;
  openEnd?: boolean;
}

abstract class Mesher {
  protected u: number;
  protected v: number;
  protected d: number;
  protected z: number;

  private meshSlice: any;
  private padSize: number;
  private unpadSize: number;
  private planarOffset: number;

  constructor(options: MesherOptions = {}) {
    this.z = 0;
    this.u = 0;
    this.v = 0;
    this.d = 0;

    this.meshSlice = compileMesher({ order: [1, 0], append: this.append.bind(this) });

    const margin = options.margin || 0;
    this.padSize = 2 + margin;
    this.unpadSize = options.openEnd ? 2 : 1;
    this.planarOffset = 2 - this.unpadSize;
  }

  pad(array: ndarray, mapper?: (v: number) => number) {
    const shape = [
      array.shape[0] + this.padSize,
      array.shape[1] + this.padSize,
      array.shape[2] + this.padSize,
    ];

    // TODO: Consider using typedarray-pool
    const padded = ndarray(new Int32Array(shape[0] * shape[1] * shape[2]), shape);
    const dest = padded.lo(1, 1, 1).hi(array.shape[0], array.shape[1], array.shape[2]);

    if (mapper) {
      map(dest, array, mapper);
    } else {
      assign(dest, array);
    }

    return padded.hi(
      array.shape[0] + 2,
      array.shape[1] + 2,
      array.shape[2] + 2,
    );
  }

  unpad(array: ndarray) {
    return array.hi(
      array.shape[0] - this.unpadSize,
      array.shape[1] - this.unpadSize,
      array.shape[2] - this.unpadSize,
    );
  }

  protected abstract append(loX: number, loY: number, hiX: number, hiY: number, val: number);

  protected computeSurface(d: number, buffer: ndarray) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;

    // Create slice
    const st = buffer.transpose(d, u, v).hi(
      buffer.shape[d],
      buffer.shape[u] - this.planarOffset,
      buffer.shape[v] - this.planarOffset,
    );
    const slice = st.pick(0);
    const n = st.shape[0];

    this.d = d;
    this.u = v;
    this.v = u;

    // Generate slices
    for (let i = 0; i < n; ++i) {
      this.z = i;
      this.meshSlice(slice);
      slice.offset += st.stride[0];
    }
  }
}

export default Mesher;
