declare const require: any;
import THREE = require('three');
import ndarray = require('ndarray');
import pool = require('typedarray-pool');
const cwise = require('cwise');
const compileCWise = require('cwise-compiler');
import Mesher from '../../../lib/Mesher';

const R_MASK = 0xff0000;
const G_MASK = 0x00ff00;
const B_MASK = 0x0000ff;

const VOXEL_MASK = (1 << 15) - 1;
const AO_SHIFT = 16;
const AO_BITS = 2;
const AO_MASK = (1 << AO_BITS) - 1;
const FLIP_BIT = (1 << (AO_SHIFT + 4 * AO_BITS));
const AO_TABLE = new Uint8Array([0, 153, 204, 255]);

const extractPalette = cwise({
  args: ['array'],
  pre: function () {
    this.result = [0];
  },
  body: function (a) {
    let idx = this.result.indexOf(a);
    if (idx === -1) {
      idx = this.result.length;
      this.result.push(a);
    }
    a = idx;
  },
  post: function () {
    return this.result;
  },
});

function growBufferIfNeeded(buffer: Uint8Array, min: number) {
  if (min <= buffer.length) return buffer;

  const newBuffer = new Uint8Array(2 * buffer.length);
  newBuffer.set(buffer);
  return newBuffer;
}

type CwiseArg = string | { offset: any, array: any };

// Calculates ambient occlusion level for a vertex
function vertexAO(s1: number, s2: number, c: number) {
  if (s1 && s2) {
    return 1;
  }
  return 3 - (s1 + s2 + c);
}

// Calculates the ambient occlusion bit mask for a facet
function facetAO(a00, a01, a02,
                 a10,      a12,
                 a20, a21, a22) {
  const s00 = (a00) ? 1 : 0;
  const s01 = (a01) ? 1 : 0;
  const s02 = (a02) ? 1 : 0;
  const s10 = (a10) ? 1 : 0;
  const s12 = (a12) ? 1 : 0;
  const s20 = (a20) ? 1 : 0;
  const s21 = (a21) ? 1 : 0;
  const s22 = (a22) ? 1 : 0;
  return (vertexAO(s10, s01, s00) << AO_SHIFT) +
    (vertexAO(s01, s12, s02) << (AO_SHIFT + AO_BITS)) +
    (vertexAO(s12, s21, s22) << (AO_SHIFT + 2 * AO_BITS)) +
    (vertexAO(s21, s10, s20) << (AO_SHIFT + 3 * AO_BITS));
}

// Generates a surface voxel, complete with ambient occlusion type
function generateSurfaceVoxel(
  v000, v001, v002,
  v010, v011, v012,
  v020, v021, v022,
  v100, v101, v102,
  v110, v111, v112,
  v120, v121, v122,
) {
  if (v111 && !v011) {
    return v111 | FLIP_BIT | facetAO(v000, v001, v002,
      v010, v012,
      v020, v021, v022);
  } else if (v011 && !v111) {
    return v011 | facetAO(v100, v101, v102,
      v110, v112,
      v120, v121, v122);
  }
}

// Compile surface stencil operator
function arg(name, lvalue, rvalue, count) {
  return { name, lvalue, rvalue, count };
}

const emptyProc = {
  args: [],
  thisVars: [],
  localVars: [],
  body: '',
};

const cwiseArgs: CwiseArg[] = ['scalar', 'array', 'array', 'array', 'array'];
const cwiseArgNames = [
  arg('_func', false, true, 3),
  arg('_o0', true, false, 1),
  arg('_o1', true, false, 1),
  arg('_o2', true, false, 1),
];
const cwiseBody = [];
for (let d = 0; d < 3; ++d) {
  const u = (d + 1) % 3;
  const v = (d + 2) % 3;
  const expr = [];
  for (let dz = 0; dz < 2; ++dz)
  for (let dy = 0; dy <= 2; ++dy)
  for (let dx = 0; dx <= 2; ++dx) {
    const x = [dx, dy, dz];
    expr.push(`_a${x[v]}${x[u]}${x[d]}`);
  }
  cwiseBody.push(`_o${d}=_func(${expr.join(',')})`);
}

const cwiseBodyStr = cwiseBody.join('\n');
for (let dx = - 1; dx <= 1; ++dx)
for (let dy = - 1; dy <= 1; ++dy)
for (let dz = - 1; dz <= 1; ++dz) {
  if (dx === 1 && dy === 1 && dz === 1) {
    continue;
  }
  if (!(dx === -1 && dy === -1 && dz === -1)) {
    cwiseArgs.push({ offset: [dx + 1, dy + 1, dz + 1], array: 3 });
  }
  const cargName = `_a${dx + 1}${dy + 1}${dz + 1}`;
  cwiseArgNames.push(arg(cargName, false, true, cwiseBodyStr.split(cargName).length - 1));
}

const surfaceStencil = compileCWise({
  args: cwiseArgs,
  pre: emptyProc,
  body: { args: cwiseArgNames, body: cwiseBodyStr, thisVars: [], localVars: [] },
  post: emptyProc,
  funcName: 'calcAO',
}).bind(undefined, generateSurfaceVoxel);

class AoMesher extends Mesher {
  static material = new THREE.ShaderMaterial({
    vertexShader: `
      precision highp float;

      attribute vec4 color;

      varying vec3 vColor;

      void main() {
        float ambientOcclusion = color.w / 255.0;
        float light = ambientOcclusion + max(0.15 * dot(128.0 - normal, vec3(1,1,1)), 0.0);
        vColor = (color.xyz / 255.0) * light;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      varying vec3 vColor;

      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
  });

  private position: Uint8Array;
  private normal: Uint8Array;
  private color: Uint8Array;
  private vc: number;
  private palette: number[][];

  constructor(openEnd: boolean) {
    super({
      openEnd,

      // As surfaceStencil accesses offset 2
      // To prevent TypedArray out of range access
      // TODO: Investigate performance impact
      margin: 1,
    });
  }

  build(padded: ndarray) {
    this.palette = extractPalette(padded).map(c => [
      (c & R_MASK) >> 16,
      (c & G_MASK) >> 8,
      (c & B_MASK) >> 0,
    ]);

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

    this.position = new Uint8Array(1024);
    this.normal = new Uint8Array(1024);
    this.color = new Uint8Array(1024);
    this.vc = 0;

    this.computeSurface(0, ao0);
    this.computeSurface(1, ao1);
    this.computeSurface(2, ao2);

    // Release buffers
    pool.freeInt32(scratch0);
    pool.freeInt32(scratch1);
    pool.freeInt32(scratch2);

    this.position = this.position.subarray(0, this.vc * 3);
    this.normal = this.normal.subarray(0, this.vc * 3);
    this.color = this.color.subarray(0, this.vc * 4);

    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.addAttribute('normal', new THREE.BufferAttribute(this.normal, 3));
    geometry.addAttribute('color', new THREE.BufferAttribute(this.color, 4));

    return new THREE.Mesh(geometry, AoMesher.material);
  }

  protected append(loX: number, loY: number, hiX: number, hiY: number, val: number) {
    this.position = growBufferIfNeeded(this.position, (this.vc + 6) * 3);
    this.normal = growBufferIfNeeded(this.normal, (this.vc + 6) * 3);
    this.color = growBufferIfNeeded(this.color, (this.vc + 6) * 4);

    const z = this.z | 0;
    const d = this.d | 0;

    const flip = !!(val & FLIP_BIT);

    const a00 = AO_TABLE[((val >>> AO_SHIFT) & AO_MASK)];
    const a10 = AO_TABLE[((val >>> (AO_SHIFT + AO_BITS)) & AO_MASK)];
    const a11 = AO_TABLE[((val >>> (AO_SHIFT + 2 * AO_BITS)) & AO_MASK)];
    const a01 = AO_TABLE[((val >>> (AO_SHIFT + 3 * AO_BITS)) & AO_MASK)];

    const [r, g, b] = this.palette[val & VOXEL_MASK];

    let nx = 128;
    let ny = 128;
    let nz = 128;
    const sign = flip ? 127 : 129;
    if (d === 0) {
      nx = sign;
    } else if (d === 1) {
      ny = sign;
    } else if (d === 2) {
      nz = sign;
    }

    let flipAO = a00 + a11 < a10 + a01;

    if (a00 + a11 === a10 + a01) {
      flipAO = Math.max(a00, a11) < Math.max(a10, a01);
    }

    if (flipAO) {
      if (!flip) {
        this.writeBuffer(loX, loY, z, nx, ny, nz, r, g, b, a00);
        this.writeBuffer(loX, hiY, z, nx, ny, nz, r, g, b, a01);
        this.writeBuffer(hiX, loY, z, nx, ny, nz, r, g, b, a10);
        this.writeBuffer(hiX, hiY, z, nx, ny, nz, r, g, b, a11);
        this.writeBuffer(hiX, loY, z, nx, ny, nz, r, g, b, a10);
        this.writeBuffer(loX, hiY, z, nx, ny, nz, r, g, b, a01);
      } else {
        this.writeBuffer(loX, loY, z, nx, ny, nz, r, g, b, a00);
        this.writeBuffer(hiX, loY, z, nx, ny, nz, r, g, b, a10);
        this.writeBuffer(loX, hiY, z, nx, ny, nz, r, g, b, a01);
        this.writeBuffer(hiX, hiY, z, nx, ny, nz, r, g, b, a11);
        this.writeBuffer(loX, hiY, z, nx, ny, nz, r, g, b, a01);
        this.writeBuffer(hiX, loY, z, nx, ny, nz, r, g, b, a10);
      }
    } else {
      // Check if flipped
      if (flip) {
        this.writeBuffer(loX, hiY, z, nx, ny, nz, r, g, b, a01);
        this.writeBuffer(loX, loY, z, nx, ny, nz, r, g, b, a00);
        this.writeBuffer(hiX, hiY, z, nx, ny, nz, r, g, b, a11);
        this.writeBuffer(hiX, loY, z, nx, ny, nz, r, g, b, a10);
        this.writeBuffer(hiX, hiY, z, nx, ny, nz, r, g, b, a11);
        this.writeBuffer(loX, loY, z, nx, ny, nz, r, g, b, a00);
      } else {
        this.writeBuffer(loX, loY, z, nx, ny, nz, r, g, b, a00);
        this.writeBuffer(loX, hiY, z, nx, ny, nz, r, g, b, a01);
        this.writeBuffer(hiX, hiY, z, nx, ny, nz, r, g, b, a11);
        this.writeBuffer(hiX, hiY, z, nx, ny, nz, r, g, b, a11);
        this.writeBuffer(hiX, loY, z, nx, ny, nz, r, g, b, a10);
        this.writeBuffer(loX, loY, z, nx, ny, nz, r, g, b, a00);
      }
    }
  }

  private writeBuffer(
    u: number, v: number, d: number, nx: number, ny: number, nz: number,
    r: number, g: number, b: number, ao: number
  ) {
    const vc3 = 3 * this.vc;
    const vc4 = 4 * this.vc;

    this.position[vc3 + this.u] = u;
    this.position[vc3 + this.v] = v;
    this.position[vc3 + this.d] = d;

    this.normal[vc3] = nx;
    this.normal[vc3 + 1] = ny;
    this.normal[vc3 + 2] = nz;

    this.color[vc4] = r;
    this.color[vc4 + 1] = g;
    this.color[vc4 + 2] = b;
    this.color[vc4 + 3] = ao;

    this.vc += 1;
  }
}

export default AoMesher;
