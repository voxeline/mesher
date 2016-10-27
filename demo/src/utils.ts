declare const require: any;
const cwise = require('cwise');
import ndarray = require('ndarray');

interface Fill {
  (array: ndarray, f: (index: [number, number, number]) => number): void;
}

export const fill = <Fill> cwise({
  args: ['index', 'array', 'scalar'],
  body: function(idx, out, f) {
    out = f(idx);
  },
});
