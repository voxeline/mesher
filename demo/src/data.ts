declare const require: any;
import ndarray = require('ndarray');
import { fill } from './utils';

const shape = [8, 8, 16];
const array = ndarray(new Int32Array(shape[0] * shape[1] * shape[2]), shape);
fill(array, idx => {
  return idx[0] * idx[0] + idx[1] * idx[1] + idx[2] * idx[2] < 150 ? 0x0000ff : 0x000000;
});

export default array;
