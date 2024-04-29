var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// /projects/Novorender/ts/dist/offline/worker/file.ts
async function storeOfflineFileSync(response, dirHandle, filename) {
  const buffer = await response.clone().arrayBuffer();
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const file = await fileHandle.createSyncAccessHandle();
  file.write(new Uint8Array(buffer));
  file.close();
}

// /projects/Novorender/ts/dist/offline/file.ts
var offlineDirs = /* @__PURE__ */ new Map();
var rootPromise = navigator.storage.getDirectory();
async function tryGetDirHandle(dirname) {
  try {
    const root = await rootPromise;
    return await root.getDirectoryHandle(dirname);
  } catch {
  }
}
async function requestOfflineFile(request, cacheFromOnline = true) {
  const { pathname } = new URL(request.url);
  const m = /\/([\da-f]{32})(?=\/).*\/(.+)$/i.exec(pathname);
  if (m && m.length == 3) {
    const [_, dirname, filename] = m;
    const dirHandle = await getDirHandle(dirname);
    if (dirHandle) {
      try {
        const fileHandle = await dirHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        return new Response(file, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
      } catch (error) {
        if (cacheFromOnline) {
          const isHashedFileName = /^[\da-f]{32}$/i.test(filename);
          const fileNotFound = error instanceof DOMException && error.name == "NotFoundError";
          if (fileNotFound && isHashedFileName) {
            const isDedicatedWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
            if (isDedicatedWorker) {
              const response = await fetch(request);
              if (response.ok) {
                storeOfflineFileSync(response.clone(), dirHandle, filename);
              }
              return response;
            } else {
            }
          }
        }
      }
    }
  }
}
async function getDirHandle(dirname) {
  let dirHandleRef = await offlineDirs.get(dirname);
  if (dirHandleRef !== null) {
    let dirHandle = dirHandleRef?.deref();
    if (!dirHandle) {
      dirHandle = await tryGetDirHandle(dirname);
      if (dirHandle) {
        dirHandleRef = new WeakRef(dirHandle);
        offlineDirs.set(dirname, dirHandleRef);
      } else {
        offlineDirs.set(dirname, null);
      }
    }
    return dirHandle;
  }
}

// /projects/Novorender/ts/dist/core3d/modules/octree/worker/download.ts
var AbortableDownload = class {
  constructor(download) {
    this.download = download;
  }
  result = Promise.resolve(void 0);
  aborted = false;
  start() {
    this.result = this.download();
  }
  abort() {
    this.aborted = true;
  }
};
var Downloader = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  activeDownloads = 0;
  completeResolve;
  async complete() {
    if (this.activeDownloads > 0) {
      const completePromise = new Promise((resolve, reject) => {
        this.completeResolve = resolve;
      });
      await completePromise;
      this.completeResolve = void 0;
    }
  }
  async request(filename) {
    const url = new URL(filename, this.baseUrl);
    if (!url.search)
      url.search = this.baseUrl?.search ?? "";
    const request = new Request(url, { mode: "cors" });
    const response = await requestOfflineFile(request) ?? await fetch(request);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}: ${response.statusText} (${url})`);
    }
    return response;
  }
  downloadArrayBufferAbortable(filename, buffer) {
    const self2 = this;
    const download = new AbortableDownload(buffer != void 0 ? downloadAsyncSize : downloadAsync);
    download.start();
    return download;
    async function downloadAsyncSize() {
      try {
        self2.activeDownloads++;
        const response = await self2.request(filename);
        if (!response.ok)
          throw new Error(`HTTP error: ${response.status} ${response.statusText}!`);
        const reader = response.body.getReader();
        const content = new Uint8Array(buffer);
        let offset = 0;
        while (!download.aborted) {
          const { done, value } = await reader.read();
          if (done)
            break;
          content.set(value, offset);
          offset += value.length;
        }
        if (!download.aborted) {
          console.assert(offset == content.length);
          return content.buffer;
        } else {
          reader.cancel();
        }
      } finally {
        self2.activeDownloads--;
        if (self2.activeDownloads == 0 && self2.completeResolve) {
          self2.completeResolve();
        }
      }
    }
    async function downloadAsync() {
      try {
        self2.activeDownloads++;
        const response = await self2.request(filename);
        if (!response.ok)
          throw new Error(`HTTP error: ${response.status} ${response.statusText}!`);
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (!download.aborted) {
          const { done, value } = await reader.read();
          if (done)
            break;
          chunks.push(value);
          size += value.length;
        }
        if (!download.aborted) {
          const content = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            content.set(chunk, offset);
            offset += chunk.length;
          }
          return content.buffer;
        } else {
          reader.cancel();
        }
      } finally {
        self2.activeDownloads--;
        if (self2.activeDownloads == 0 && self2.completeResolve) {
          self2.completeResolve();
        }
      }
    }
  }
};

// /projects/Novorender/ts/dist/core3d/modules/octree/mutex.ts
var Mutex = class {
  _view;
  constructor(buffer) {
    this._view = new Int32Array(buffer, 0, 1);
  }
  // will loop until lock is available, so be careful using this in main thread
  lockSpin() {
    const { _view } = this;
    for (; ; ) {
      if (Atomics.compareExchange(_view, 0, 0 /* unlocked */, 1 /* locked */) == 0 /* unlocked */) {
        return;
      }
    }
  }
  // blocking call, use in workers only!
  lockSync() {
    console.assert(self.Worker != void 0);
    const { _view } = this;
    for (; ; ) {
      if (Atomics.compareExchange(_view, 0, 0 /* unlocked */, 1 /* locked */) == 0 /* unlocked */) {
        return;
      }
      Atomics.wait(_view, 0, 1 /* locked */);
    }
  }
  // safe to use from main thread
  async lockAsync() {
    const { _view } = this;
    for (; ; ) {
      if (Atomics.compareExchange(_view, 0, 0 /* unlocked */, 1 /* locked */) == 0 /* unlocked */) {
        return;
      }
      const { async, value } = Atomics.waitAsync(_view, 0, 1 /* locked */);
      if (async) {
        await value;
      }
    }
  }
  unlock() {
    const { _view } = this;
    if (Atomics.compareExchange(_view, 0, 1 /* locked */, 0 /* unlocked */) != 1 /* locked */) {
      throw new Error("Mutex is in inconsistent state: unlock on unlocked Mutex.");
    }
    Atomics.notify(_view, 0);
  }
};

// /projects/Novorender/ts/node_modules/gl-matrix/esm/common.js
var EPSILON = 1e-6;
var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
var RANDOM = Math.random;
var degree = Math.PI / 180;
if (!Math.hypot)
  Math.hypot = function() {
    var y = 0, i = arguments.length;
    while (i--) {
      y += arguments[i] * arguments[i];
    }
    return Math.sqrt(y);
  };

// /projects/Novorender/ts/node_modules/gl-matrix/esm/vec3.js
var vec3_exports = {};
__export(vec3_exports, {
  add: () => add,
  angle: () => angle,
  bezier: () => bezier,
  ceil: () => ceil,
  clone: () => clone,
  copy: () => copy,
  create: () => create,
  cross: () => cross,
  dist: () => dist,
  distance: () => distance,
  div: () => div,
  divide: () => divide,
  dot: () => dot,
  equals: () => equals,
  exactEquals: () => exactEquals,
  floor: () => floor,
  forEach: () => forEach,
  fromValues: () => fromValues,
  hermite: () => hermite,
  inverse: () => inverse,
  len: () => len,
  length: () => length,
  lerp: () => lerp,
  max: () => max,
  min: () => min,
  mul: () => mul,
  multiply: () => multiply,
  negate: () => negate,
  normalize: () => normalize,
  random: () => random,
  rotateX: () => rotateX,
  rotateY: () => rotateY,
  rotateZ: () => rotateZ,
  round: () => round,
  scale: () => scale,
  scaleAndAdd: () => scaleAndAdd,
  set: () => set,
  sqrDist: () => sqrDist,
  sqrLen: () => sqrLen,
  squaredDistance: () => squaredDistance,
  squaredLength: () => squaredLength,
  str: () => str,
  sub: () => sub,
  subtract: () => subtract,
  transformMat3: () => transformMat3,
  transformMat4: () => transformMat4,
  transformQuat: () => transformQuat,
  zero: () => zero
});
function create() {
  var out = new ARRAY_TYPE(3);
  if (ARRAY_TYPE != Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}
function clone(a) {
  var out = new ARRAY_TYPE(3);
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}
function length(a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  return Math.hypot(x, y, z);
}
function fromValues(x, y, z) {
  var out = new ARRAY_TYPE(3);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}
function copy(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}
function set(out, x, y, z) {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}
function add(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}
function subtract(out, a, b) {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}
function multiply(out, a, b) {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  out[2] = a[2] * b[2];
  return out;
}
function divide(out, a, b) {
  out[0] = a[0] / b[0];
  out[1] = a[1] / b[1];
  out[2] = a[2] / b[2];
  return out;
}
function ceil(out, a) {
  out[0] = Math.ceil(a[0]);
  out[1] = Math.ceil(a[1]);
  out[2] = Math.ceil(a[2]);
  return out;
}
function floor(out, a) {
  out[0] = Math.floor(a[0]);
  out[1] = Math.floor(a[1]);
  out[2] = Math.floor(a[2]);
  return out;
}
function min(out, a, b) {
  out[0] = Math.min(a[0], b[0]);
  out[1] = Math.min(a[1], b[1]);
  out[2] = Math.min(a[2], b[2]);
  return out;
}
function max(out, a, b) {
  out[0] = Math.max(a[0], b[0]);
  out[1] = Math.max(a[1], b[1]);
  out[2] = Math.max(a[2], b[2]);
  return out;
}
function round(out, a) {
  out[0] = Math.round(a[0]);
  out[1] = Math.round(a[1]);
  out[2] = Math.round(a[2]);
  return out;
}
function scale(out, a, b) {
  out[0] = a[0] * b;
  out[1] = a[1] * b;
  out[2] = a[2] * b;
  return out;
}
function scaleAndAdd(out, a, b, scale2) {
  out[0] = a[0] + b[0] * scale2;
  out[1] = a[1] + b[1] * scale2;
  out[2] = a[2] + b[2] * scale2;
  return out;
}
function distance(a, b) {
  var x = b[0] - a[0];
  var y = b[1] - a[1];
  var z = b[2] - a[2];
  return Math.hypot(x, y, z);
}
function squaredDistance(a, b) {
  var x = b[0] - a[0];
  var y = b[1] - a[1];
  var z = b[2] - a[2];
  return x * x + y * y + z * z;
}
function squaredLength(a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  return x * x + y * y + z * z;
}
function negate(out, a) {
  out[0] = -a[0];
  out[1] = -a[1];
  out[2] = -a[2];
  return out;
}
function inverse(out, a) {
  out[0] = 1 / a[0];
  out[1] = 1 / a[1];
  out[2] = 1 / a[2];
  return out;
}
function normalize(out, a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  var len2 = x * x + y * y + z * z;
  if (len2 > 0) {
    len2 = 1 / Math.sqrt(len2);
  }
  out[0] = a[0] * len2;
  out[1] = a[1] * len2;
  out[2] = a[2] * len2;
  return out;
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(out, a, b) {
  var ax = a[0], ay = a[1], az = a[2];
  var bx = b[0], by = b[1], bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}
function lerp(out, a, b, t) {
  var ax = a[0];
  var ay = a[1];
  var az = a[2];
  out[0] = ax + t * (b[0] - ax);
  out[1] = ay + t * (b[1] - ay);
  out[2] = az + t * (b[2] - az);
  return out;
}
function hermite(out, a, b, c, d, t) {
  var factorTimes2 = t * t;
  var factor1 = factorTimes2 * (2 * t - 3) + 1;
  var factor2 = factorTimes2 * (t - 2) + t;
  var factor3 = factorTimes2 * (t - 1);
  var factor4 = factorTimes2 * (3 - 2 * t);
  out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
  out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
  out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
  return out;
}
function bezier(out, a, b, c, d, t) {
  var inverseFactor = 1 - t;
  var inverseFactorTimesTwo = inverseFactor * inverseFactor;
  var factorTimes2 = t * t;
  var factor1 = inverseFactorTimesTwo * inverseFactor;
  var factor2 = 3 * t * inverseFactorTimesTwo;
  var factor3 = 3 * factorTimes2 * inverseFactor;
  var factor4 = factorTimes2 * t;
  out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
  out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
  out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
  return out;
}
function random(out, scale2) {
  scale2 = scale2 || 1;
  var r = RANDOM() * 2 * Math.PI;
  var z = RANDOM() * 2 - 1;
  var zScale = Math.sqrt(1 - z * z) * scale2;
  out[0] = Math.cos(r) * zScale;
  out[1] = Math.sin(r) * zScale;
  out[2] = z * scale2;
  return out;
}
function transformMat4(out, a, m) {
  var x = a[0], y = a[1], z = a[2];
  var w = m[3] * x + m[7] * y + m[11] * z + m[15];
  w = w || 1;
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return out;
}
function transformMat3(out, a, m) {
  var x = a[0], y = a[1], z = a[2];
  out[0] = x * m[0] + y * m[3] + z * m[6];
  out[1] = x * m[1] + y * m[4] + z * m[7];
  out[2] = x * m[2] + y * m[5] + z * m[8];
  return out;
}
function transformQuat(out, a, q) {
  var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  var x = a[0], y = a[1], z = a[2];
  var uvx = qy * z - qz * y, uvy = qz * x - qx * z, uvz = qx * y - qy * x;
  var uuvx = qy * uvz - qz * uvy, uuvy = qz * uvx - qx * uvz, uuvz = qx * uvy - qy * uvx;
  var w2 = qw * 2;
  uvx *= w2;
  uvy *= w2;
  uvz *= w2;
  uuvx *= 2;
  uuvy *= 2;
  uuvz *= 2;
  out[0] = x + uvx + uuvx;
  out[1] = y + uvy + uuvy;
  out[2] = z + uvz + uuvz;
  return out;
}
function rotateX(out, a, b, rad) {
  var p = [], r = [];
  p[0] = a[0] - b[0];
  p[1] = a[1] - b[1];
  p[2] = a[2] - b[2];
  r[0] = p[0];
  r[1] = p[1] * Math.cos(rad) - p[2] * Math.sin(rad);
  r[2] = p[1] * Math.sin(rad) + p[2] * Math.cos(rad);
  out[0] = r[0] + b[0];
  out[1] = r[1] + b[1];
  out[2] = r[2] + b[2];
  return out;
}
function rotateY(out, a, b, rad) {
  var p = [], r = [];
  p[0] = a[0] - b[0];
  p[1] = a[1] - b[1];
  p[2] = a[2] - b[2];
  r[0] = p[2] * Math.sin(rad) + p[0] * Math.cos(rad);
  r[1] = p[1];
  r[2] = p[2] * Math.cos(rad) - p[0] * Math.sin(rad);
  out[0] = r[0] + b[0];
  out[1] = r[1] + b[1];
  out[2] = r[2] + b[2];
  return out;
}
function rotateZ(out, a, b, rad) {
  var p = [], r = [];
  p[0] = a[0] - b[0];
  p[1] = a[1] - b[1];
  p[2] = a[2] - b[2];
  r[0] = p[0] * Math.cos(rad) - p[1] * Math.sin(rad);
  r[1] = p[0] * Math.sin(rad) + p[1] * Math.cos(rad);
  r[2] = p[2];
  out[0] = r[0] + b[0];
  out[1] = r[1] + b[1];
  out[2] = r[2] + b[2];
  return out;
}
function angle(a, b) {
  var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2], mag1 = Math.sqrt(ax * ax + ay * ay + az * az), mag2 = Math.sqrt(bx * bx + by * by + bz * bz), mag = mag1 * mag2, cosine = mag && dot(a, b) / mag;
  return Math.acos(Math.min(Math.max(cosine, -1), 1));
}
function zero(out) {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  return out;
}
function str(a) {
  return "vec3(" + a[0] + ", " + a[1] + ", " + a[2] + ")";
}
function exactEquals(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
function equals(a, b) {
  var a0 = a[0], a1 = a[1], a2 = a[2];
  var b0 = b[0], b1 = b[1], b2 = b[2];
  return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2));
}
var sub = subtract;
var mul = multiply;
var div = divide;
var dist = distance;
var sqrDist = squaredDistance;
var len = length;
var sqrLen = squaredLength;
var forEach = function() {
  var vec = create();
  return function(a, stride, offset, count, fn, arg) {
    var i, l;
    if (!stride) {
      stride = 3;
    }
    if (!offset) {
      offset = 0;
    }
    if (count) {
      l = Math.min(count * stride + offset, a.length);
    } else {
      l = a.length;
    }
    for (i = offset; i < l; i += stride) {
      vec[0] = a[i];
      vec[1] = a[i + 1];
      vec[2] = a[i + 2];
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
      a[i + 2] = vec[2];
    }
    return a;
  };
}();

// /projects/Novorender/ts/dist/core3d/modules/octree/worker/util.ts
var Float16Array = Uint16Array;
var BufferReader = class {
  constructor(buffer) {
    this.buffer = buffer;
    this._u8 = new Uint8Array(buffer, 0, Math.floor(buffer.byteLength / Uint8Array.BYTES_PER_ELEMENT));
    this._u16 = new Uint16Array(buffer, 0, Math.floor(buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT));
    this._u32 = new Uint32Array(buffer, 0, Math.floor(buffer.byteLength / Uint32Array.BYTES_PER_ELEMENT));
    this._i8 = new Int8Array(buffer, 0, Math.floor(buffer.byteLength / Int8Array.BYTES_PER_ELEMENT));
    this._i16 = new Int16Array(buffer, 0, Math.floor(buffer.byteLength / Int16Array.BYTES_PER_ELEMENT));
    this._i32 = new Int32Array(buffer, 0, Math.floor(buffer.byteLength / Int32Array.BYTES_PER_ELEMENT));
    this._f16 = new Uint16Array(buffer, 0, Math.floor(buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT));
    this._f32 = new Float32Array(buffer, 0, Math.floor(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT));
    this._f64 = new Float64Array(buffer, 0, Math.floor(buffer.byteLength / Float64Array.BYTES_PER_ELEMENT));
  }
  pos = 0;
  _u8;
  _u16;
  _u32;
  _i8;
  _i16;
  _i32;
  _f16;
  _f32;
  _f64;
  read(ar, size) {
    if (size == 0)
      return ar.subarray(0, 0);
    const align = ar.BYTES_PER_ELEMENT;
    var padding = align - 1 - (this.pos + align - 1) % align;
    console.assert(padding >= 0 && padding < align);
    const begin = (this.pos + padding) / align;
    const end = begin + size;
    this.pos = end * ar.BYTES_PER_ELEMENT;
    return ar.subarray(begin, end);
  }
  get eof() {
    return this.pos == this.buffer.byteLength;
  }
  u8(size) {
    return this.read(this._u8, size);
  }
  u16(size) {
    return this.read(this._u16, size);
  }
  u32(size) {
    return this.read(this._u32, size);
  }
  i8(size) {
    return this.read(this._i8, size);
  }
  i16(size) {
    return this.read(this._i16, size);
  }
  i32(size) {
    return this.read(this._i32, size);
  }
  f16(size) {
    return this.read(this._f16, size);
  }
  f32(size) {
    return this.read(this._f32, size);
  }
  f64(size) {
    return this.read(this._f64, size);
  }
};

// /projects/Novorender/ts/dist/webgl2/misc.ts
function getBufferViewType(type) {
  switch (type) {
    case "BYTE":
      return Int8Array;
    case "UNSIGNED_BYTE":
      return Uint8Array;
    case "SHORT":
      return Int16Array;
    case "UNSIGNED_SHORT_5_6_5":
    case "UNSIGNED_SHORT_4_4_4_4":
    case "UNSIGNED_SHORT_5_5_5_1":
    case "HALF_FLOAT":
    case "HALF_FLOAT_OES":
      return Uint16Array;
    case "UNSIGNED_INT":
    case "UNSIGNED_INT_24_8_WEBGL":
    case "UNSIGNED_INT_5_9_9_9_REV":
    case "UNSIGNED_INT_2_10_10_10_REV":
    case "UNSIGNED_INT_10F_11F_11F_REV":
      return Uint32Array;
    case "INT":
      return Int32Array;
    case "FLOAT":
      return Float32Array;
  }
  throw new Error(`Unknown buffer type: ${type}!`);
}

// /projects/Novorender/ts/dist/webgl2/texture.ts
var internalFormat2FormatLookup = {
  [6407 /* RGB */]: 6407 /* RGB */,
  [6408 /* RGBA */]: 6408 /* RGBA */,
  [6410 /* LUMINANCE_ALPHA */]: 6410 /* LUMINANCE_ALPHA */,
  [6409 /* LUMINANCE */]: 6409 /* LUMINANCE */,
  [6406 /* ALPHA */]: 6406 /* ALPHA */,
  [33321 /* R8 */]: 6403 /* RED */,
  [36756 /* R8_SNORM */]: 6403 /* RED */,
  [33323 /* RG8 */]: 33319 /* RG */,
  [36757 /* RG8_SNORM */]: 33319 /* RG */,
  [32849 /* RGB8 */]: 6407 /* RGB */,
  [36758 /* RGB8_SNORM */]: 6407 /* RGB */,
  [36194 /* RGB565 */]: 6407 /* RGB */,
  [32854 /* RGBA4 */]: 6408 /* RGBA */,
  [32855 /* RGB5_A1 */]: 6408 /* RGBA */,
  [32856 /* RGBA8 */]: 6408 /* RGBA */,
  [36759 /* RGBA8_SNORM */]: 6408 /* RGBA */,
  [32857 /* RGB10_A2 */]: 6408 /* RGBA */,
  [36975 /* RGB10_A2UI */]: 36249 /* RGBA_INTEGER */,
  [35905 /* SRGB8 */]: 6407 /* RGB */,
  [35907 /* SRGB8_ALPHA8 */]: 6408 /* RGBA */,
  [33325 /* R16F */]: 6403 /* RED */,
  [33327 /* RG16F */]: 33319 /* RG */,
  [34843 /* RGB16F */]: 6407 /* RGB */,
  [34842 /* RGBA16F */]: 6408 /* RGBA */,
  [33326 /* R32F */]: 6403 /* RED */,
  [33328 /* RG32F */]: 33319 /* RG */,
  [34837 /* RGB32F */]: 6407 /* RGB */,
  [34836 /* RGBA32F */]: 6408 /* RGBA */,
  [35898 /* R11F_G11F_B10F */]: 6407 /* RGB */,
  [35901 /* RGB9_E5 */]: 6407 /* RGB */,
  [33329 /* R8I */]: 36244 /* RED_INTEGER */,
  [33330 /* R8UI */]: 36244 /* RED_INTEGER */,
  [33331 /* R16I */]: 36244 /* RED_INTEGER */,
  [33332 /* R16UI */]: 36244 /* RED_INTEGER */,
  [33333 /* R32I */]: 36244 /* RED_INTEGER */,
  [33334 /* R32UI */]: 36244 /* RED_INTEGER */,
  [33335 /* RG8I */]: 33320 /* RG_INTEGER */,
  [33336 /* RG8UI */]: 33320 /* RG_INTEGER */,
  [33337 /* RG16I */]: 33320 /* RG_INTEGER */,
  [33338 /* RG16UI */]: 33320 /* RG_INTEGER */,
  [33339 /* RG32I */]: 33320 /* RG_INTEGER */,
  [33340 /* RG32UI */]: 33320 /* RG_INTEGER */,
  [36239 /* RGB8I */]: 36248 /* RGB_INTEGER */,
  [36221 /* RGB8UI */]: 36248 /* RGB_INTEGER */,
  [36233 /* RGB16I */]: 36248 /* RGB_INTEGER */,
  [36215 /* RGB16UI */]: 36248 /* RGB_INTEGER */,
  [36227 /* RGB32I */]: 36248 /* RGB_INTEGER */,
  [36209 /* RGB32UI */]: 36248 /* RGB_INTEGER */,
  [36238 /* RGBA8I */]: 36249 /* RGBA_INTEGER */,
  [36220 /* RGBA8UI */]: 36249 /* RGBA_INTEGER */,
  [36232 /* RGBA16I */]: 36249 /* RGBA_INTEGER */,
  [36214 /* RGBA16UI */]: 36249 /* RGBA_INTEGER */,
  [36226 /* RGBA32I */]: 36249 /* RGBA_INTEGER */,
  [36208 /* RGBA32UI */]: 36249 /* RGBA_INTEGER */,
  [33189 /* DEPTH_COMPONENT16 */]: 6402 /* DEPTH_COMPONENT */,
  [33190 /* DEPTH_COMPONENT24 */]: 6402 /* DEPTH_COMPONENT */,
  [36012 /* DEPTH_COMPONENT32F */]: 6402 /* DEPTH_COMPONENT */,
  [35056 /* DEPTH24_STENCIL8 */]: 34041 /* DEPTH_STENCIL */,
  [36013 /* DEPTH32F_STENCIL8 */]: 34041 /* DEPTH_STENCIL */
};
var compressedFormats = {
  // WEBGL_compressed_texture_s3tc
  COMPRESSED_RGB_S3TC_DXT1_EXT: 33776 /* COMPRESSED_RGB_S3TC_DXT1_EXT */,
  COMPRESSED_RGBA_S3TC_DXT1_EXT: 33777 /* COMPRESSED_RGBA_S3TC_DXT1_EXT */,
  COMPRESSED_RGBA_S3TC_DXT3_EXT: 33778 /* COMPRESSED_RGBA_S3TC_DXT3_EXT */,
  COMPRESSED_RGBA_S3TC_DXT5_EXT: 33779 /* COMPRESSED_RGBA_S3TC_DXT5_EXT */,
  // WEBGL_compressed_texture_s3tc_srgb
  COMPRESSED_SRGB_S3TC_DXT1_EXT: 35916 /* COMPRESSED_SRGB_S3TC_DXT1_EXT */,
  COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT: 35917 /* COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT */,
  COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT: 35918 /* COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT */,
  COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT: 35919 /* COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT */,
  // WEBGL_compressed_texture_etc
  COMPRESSED_R11_EAC: 37488 /* COMPRESSED_R11_EAC */,
  COMPRESSED_SIGNED_R11_EAC: 37489 /* COMPRESSED_SIGNED_R11_EAC */,
  COMPRESSED_RG11_EAC: 37490 /* COMPRESSED_RG11_EAC */,
  COMPRESSED_SIGNED_RG11_EAC: 37491 /* COMPRESSED_SIGNED_RG11_EAC */,
  COMPRESSED_RGB8_ETC2: 37492 /* COMPRESSED_RGB8_ETC2 */,
  COMPRESSED_RGBA8_ETC2_EAC: 37493 /* COMPRESSED_RGBA8_ETC2_EAC */,
  COMPRESSED_SRGB8_ETC2: 37494 /* COMPRESSED_SRGB8_ETC2 */,
  COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: 37495 /* COMPRESSED_SRGB8_ALPHA8_ETC2_EAC */,
  COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: 37496 /* COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2 */,
  COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2: 37497 /* COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2 */,
  // WEBGL_compressed_texture_pvrtc
  COMPRESSED_RGB_PVRTC_4BPPV1_IMG: 35840 /* COMPRESSED_RGB_PVRTC_4BPPV1_IMG */,
  COMPRESSED_RGBA_PVRTC_4BPPV1_IMG: 35842 /* COMPRESSED_RGBA_PVRTC_4BPPV1_IMG */,
  COMPRESSED_RGB_PVRTC_2BPPV1_IMG: 35841 /* COMPRESSED_RGB_PVRTC_2BPPV1_IMG */,
  COMPRESSED_RGBA_PVRTC_2BPPV1_IMG: 35843 /* COMPRESSED_RGBA_PVRTC_2BPPV1_IMG */,
  // WEBGL_compressed_texture_etc1    
  COMPRESSED_RGB_ETC1_WEBGL: 36196 /* COMPRESSED_RGB_ETC1_WEBGL */,
  // WEBGL_compressed_texture_astc    
  COMPRESSED_RGBA_ASTC_4x4_KHR: 37808 /* COMPRESSED_RGBA_ASTC_4x4_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR: 37840 /* COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR */,
  COMPRESSED_RGBA_ASTC_5x4_KHR: 37809 /* COMPRESSED_RGBA_ASTC_5x4_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR: 37841 /* COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR */,
  COMPRESSED_RGBA_ASTC_5x5_KHR: 37810 /* COMPRESSED_RGBA_ASTC_5x5_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR: 37842 /* COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR */,
  COMPRESSED_RGBA_ASTC_6x5_KHR: 37811 /* COMPRESSED_RGBA_ASTC_6x5_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR: 37843 /* COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR */,
  COMPRESSED_RGBA_ASTC_6x6_KHR: 37812 /* COMPRESSED_RGBA_ASTC_6x6_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR: 37844 /* COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR */,
  COMPRESSED_RGBA_ASTC_8x5_KHR: 37813 /* COMPRESSED_RGBA_ASTC_8x5_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR: 37845 /* COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR */,
  COMPRESSED_RGBA_ASTC_8x6_KHR: 37814 /* COMPRESSED_RGBA_ASTC_8x6_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR: 37846 /* COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR */,
  COMPRESSED_RGBA_ASTC_8x8_KHR: 37815 /* COMPRESSED_RGBA_ASTC_8x8_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR: 37847 /* COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR */,
  COMPRESSED_RGBA_ASTC_10x5_KHR: 37816 /* COMPRESSED_RGBA_ASTC_10x5_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR: 37848 /* COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR */,
  COMPRESSED_RGBA_ASTC_10x6_KHR: 37817 /* COMPRESSED_RGBA_ASTC_10x6_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR: 37849 /* COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR */,
  COMPRESSED_RGBA_ASTC_10x10_KHR: 37819 /* COMPRESSED_RGBA_ASTC_10x10_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR: 37851 /* COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR */,
  COMPRESSED_RGBA_ASTC_12x10_KHR: 37820 /* COMPRESSED_RGBA_ASTC_12x10_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR: 37852 /* COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR */,
  COMPRESSED_RGBA_ASTC_12x12_KHR: 37821 /* COMPRESSED_RGBA_ASTC_12x12_KHR */,
  COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR: 37853 /* COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR */,
  // EXT_texture_compression_bptc    
  COMPRESSED_RGBA_BPTC_UNORM_EXT: 36492 /* COMPRESSED_RGBA_BPTC_UNORM_EXT */,
  COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT: 36493 /* COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT */,
  COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT: 36494 /* COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT */,
  COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT: 36495 /* COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT */,
  // EXT_texture_compression_rgtc    
  COMPRESSED_RED_RGTC1_EXT: 36283 /* COMPRESSED_RED_RGTC1_EXT */,
  COMPRESSED_SIGNED_RED_RGTC1_EXT: 36284 /* COMPRESSED_SIGNED_RED_RGTC1_EXT */,
  COMPRESSED_RED_GREEN_RGTC2_EXT: 36285 /* COMPRESSED_RED_GREEN_RGTC2_EXT */,
  COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT: 36286 /* COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT */
};

// /projects/Novorender/ts/dist/core3d/ktx.ts
var identifier = new Uint8Array([171, 75, 84, 88, 32, 49, 49, 187, 13, 10, 26, 10]);
var HEADER_LEN = 12 + 13 * 4;
var textureDataType = {
  [5121 /* UNSIGNED_BYTE */]: "UNSIGNED_BYTE",
  [33635 /* UNSIGNED_SHORT_5_6_5 */]: "UNSIGNED_SHORT_5_6_5",
  [32819 /* UNSIGNED_SHORT_4_4_4_4 */]: "UNSIGNED_SHORT_4_4_4_4",
  [32820 /* UNSIGNED_SHORT_5_5_5_1 */]: "UNSIGNED_SHORT_5_5_5_1",
  [5131 /* HALF_FLOAT */]: "HALF_FLOAT",
  // [GL.HALF_FLOAT_OES]: "HALF_FLOAT_OES",
  [5126 /* FLOAT */]: "FLOAT",
  [5123 /* UNSIGNED_SHORT */]: "UNSIGNED_SHORT",
  [5125 /* UNSIGNED_INT */]: "UNSIGNED_INT",
  [34042 /* UNSIGNED_INT_24_8 */]: "UNSIGNED_INT_24_8",
  [5120 /* BYTE */]: "BYTE",
  [5122 /* SHORT */]: "SHORT",
  [5124 /* INT */]: "INT",
  // [GL.FLOAT_32_UNSIGNED_INT_24_8_REV]: "FLOAT_32_UNSIGNED_INT_24_8_REV",
  [35902 /* UNSIGNED_INT_5_9_9_9_REV */]: "UNSIGNED_INT_5_9_9_9_REV",
  [33640 /* UNSIGNED_INT_2_10_10_10_REV */]: "UNSIGNED_INT_2_10_10_10_REV",
  [35899 /* UNSIGNED_INT_10F_11F_11F_REV */]: "UNSIGNED_INT_10F_11F_11F_REV"
};
var textureFormatBase = {
  [6407 /* RGB */]: "RGB",
  [6408 /* RGBA */]: "RGBA",
  [6406 /* ALPHA */]: "ALPHA",
  [6409 /* LUMINANCE */]: "LUMINANCE",
  [6410 /* LUMINANCE_ALPHA */]: "LUMINANCE_ALPHA",
  [6402 /* DEPTH_COMPONENT */]: "DEPTH_COMPONENT",
  [34041 /* DEPTH_STENCIL */]: "DEPTH_STENCIL",
  [35904 /* SRGB_EXT */]: "SRGB_EXT",
  [35906 /* SRGB_ALPHA_EXT */]: "SRGB_ALPHA_EXT",
  [6403 /* RED */]: "RED",
  [33319 /* RG */]: "RG",
  [36244 /* RED_INTEGER */]: "RED_INTEGER",
  [33320 /* RG_INTEGER */]: "RG_INTEGER",
  [36248 /* RGB_INTEGER */]: "RGB_INTEGER",
  [36249 /* RGBA_INTEGER */]: "RGBA_INTEGER"
};
var textureFormatUncompressed = {
  [33321 /* R8 */]: "R8",
  [36756 /* R8_SNORM */]: "R8_SNORM",
  [33323 /* RG8 */]: "RG8",
  [36757 /* RG8_SNORM */]: "RG8_SNORM",
  [32849 /* RGB8 */]: "RGB8",
  [36758 /* RGB8_SNORM */]: "RGB8_SNORM",
  [36194 /* RGB565 */]: "RGB565",
  [32854 /* RGBA4 */]: "RGBA4",
  [32855 /* RGB5_A1 */]: "RGB5_A1",
  [32856 /* RGBA8 */]: "RGBA8",
  [36759 /* RGBA8_SNORM */]: "RGBA8_SNORM",
  [32857 /* RGB10_A2 */]: "RGB10_A2",
  [36975 /* RGB10_A2UI */]: "RGB10_A2UI",
  [35905 /* SRGB8 */]: "SRGB8",
  [35907 /* SRGB8_ALPHA8 */]: "SRGB8_ALPHA8",
  [33325 /* R16F */]: "R16F",
  [33327 /* RG16F */]: "RG16F",
  [34843 /* RGB16F */]: "RGB16F",
  [34842 /* RGBA16F */]: "RGBA16F",
  [33326 /* R32F */]: "R32F",
  [33328 /* RG32F */]: "RG32F",
  [34837 /* RGB32F */]: "RGB32F",
  [34836 /* RGBA32F */]: "RGBA32F",
  [35898 /* R11F_G11F_B10F */]: "R11F_G11F_B10F",
  [35901 /* RGB9_E5 */]: "RGB9_E5",
  [33329 /* R8I */]: "R8I",
  [33330 /* R8UI */]: "R8UI",
  [33331 /* R16I */]: "R16I",
  [33332 /* R16UI */]: "R16UI",
  [33333 /* R32I */]: "R32I",
  [33334 /* R32UI */]: "R32UI",
  [33335 /* RG8I */]: "RG8I",
  [33336 /* RG8UI */]: "RG8UI",
  [33337 /* RG16I */]: "RG16I",
  [33338 /* RG16UI */]: "RG16UI",
  [33339 /* RG32I */]: "RG32I",
  [33340 /* RG32UI */]: "RG32UI",
  [36239 /* RGB8I */]: "RGB8I",
  [36221 /* RGB8UI */]: "RGB8UI",
  [36233 /* RGB16I */]: "RGB16I",
  [36215 /* RGB16UI */]: "RGB16UI",
  [36227 /* RGB32I */]: "RGB32I",
  [36209 /* RGB32UI */]: "RGB32UI",
  [36238 /* RGBA8I */]: "RGBA8I",
  [36220 /* RGBA8UI */]: "RGBA8UI",
  [36232 /* RGBA16I */]: "RGBA16I",
  [36214 /* RGBA16UI */]: "RGBA16UI",
  [36226 /* RGBA32I */]: "RGBA32I",
  [36208 /* RGBA32UI */]: "RGBA32UI"
  // [GL.SRGB8_ALPHA8_EXT]: "SRGB8_ALPHA8_EXT",
};
var textureFormatCompressed = {
  [33776 /* COMPRESSED_RGB_S3TC_DXT1_EXT */]: "COMPRESSED_RGB_S3TC_DXT1_EXT",
  [33777 /* COMPRESSED_RGBA_S3TC_DXT1_EXT */]: "COMPRESSED_RGBA_S3TC_DXT1_EXT",
  [33778 /* COMPRESSED_RGBA_S3TC_DXT3_EXT */]: "COMPRESSED_RGBA_S3TC_DXT3_EXT",
  [33779 /* COMPRESSED_RGBA_S3TC_DXT5_EXT */]: "COMPRESSED_RGBA_S3TC_DXT5_EXT",
  [37488 /* COMPRESSED_R11_EAC */]: "COMPRESSED_R11_EAC",
  [37489 /* COMPRESSED_SIGNED_R11_EAC */]: "COMPRESSED_SIGNED_R11_EAC",
  [37490 /* COMPRESSED_RG11_EAC */]: "COMPRESSED_RG11_EAC",
  [37491 /* COMPRESSED_SIGNED_RG11_EAC */]: "COMPRESSED_SIGNED_RG11_EAC",
  [37492 /* COMPRESSED_RGB8_ETC2 */]: "COMPRESSED_RGB8_ETC2",
  [37493 /* COMPRESSED_RGBA8_ETC2_EAC */]: "COMPRESSED_RGBA8_ETC2_EAC",
  [37494 /* COMPRESSED_SRGB8_ETC2 */]: "COMPRESSED_SRGB8_ETC2",
  [37495 /* COMPRESSED_SRGB8_ALPHA8_ETC2_EAC */]: "COMPRESSED_SRGB8_ALPHA8_ETC2_EAC",
  [37496 /* COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2 */]: "COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2",
  [37497 /* COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2 */]: "COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2",
  [35840 /* COMPRESSED_RGB_PVRTC_4BPPV1_IMG */]: "COMPRESSED_RGB_PVRTC_4BPPV1_IMG",
  [35842 /* COMPRESSED_RGBA_PVRTC_4BPPV1_IMG */]: "COMPRESSED_RGBA_PVRTC_4BPPV1_IMG",
  [35841 /* COMPRESSED_RGB_PVRTC_2BPPV1_IMG */]: "COMPRESSED_RGB_PVRTC_2BPPV1_IMG",
  [35843 /* COMPRESSED_RGBA_PVRTC_2BPPV1_IMG */]: "COMPRESSED_RGBA_PVRTC_2BPPV1_IMG",
  [36196 /* COMPRESSED_RGB_ETC1_WEBGL */]: "COMPRESSED_RGB_ETC1_WEBGL"
  // [GL.COMPRESSED_RGB_ATC_WEBGL]: "COMPRESSED_RGB_ATC_WEBGL",
  // [GL.COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL]: "COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL",
  // [GL.COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL]: "COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL",
};
var textureFormatInternal = {
  ...textureFormatUncompressed,
  ...textureFormatCompressed
  // [GL.DEPTH_COMPONENT16]: "DEPTH_COMPONENT16",
  // [GL.DEPTH_COMPONENT24]: "DEPTH_COMPONENT24",
  // [GL.DEPTH_COMPONENT32F]: "DEPTH_COMPONENT32F",
  // [GL.DEPTH32F_STENCIL8]: "DEPTH32F_STENCIL8",
};
function parseHeader(ktx) {
  const idDataView = new DataView(ktx.buffer, ktx.byteOffset, 12);
  for (let i = 0; i < identifier.length; i++) {
    if (idDataView.getUint8(i) != identifier[i]) {
      throw new Error("texture missing KTX identifier");
    }
  }
  const dataSize = Uint32Array.BYTES_PER_ELEMENT;
  const headerDataView = new DataView(ktx.buffer, 12 + ktx.byteOffset, 13 * dataSize);
  const endianness = headerDataView.getUint32(0, true);
  const littleEndian = endianness === 67305985;
  return {
    glType: headerDataView.getUint32(1 * dataSize, littleEndian),
    // must be 0 for compressed textures
    glTypeSize: headerDataView.getUint32(2 * dataSize, littleEndian),
    // must be 1 for compressed textures
    glFormat: headerDataView.getUint32(3 * dataSize, littleEndian),
    // must be 0 for compressed textures
    glInternalFormat: headerDataView.getUint32(4 * dataSize, littleEndian),
    // the value of arg passed to gl.texImage2D() or gl.compressedTexImage2D(,,x,,,,)
    glBaseInternalFormat: headerDataView.getUint32(5 * dataSize, littleEndian),
    // specify GL_RGB, GL_RGBA, GL_ALPHA, etc (un-compressed only)
    pixelWidth: headerDataView.getUint32(6 * dataSize, littleEndian),
    // level 0 value of arg passed to gl.compressedTexImage2D(,,,x,,,)
    pixelHeight: headerDataView.getUint32(7 * dataSize, littleEndian),
    // level 0 value of arg passed to gl.compressedTexImage2D(,,,,x,,)
    pixelDepth: headerDataView.getUint32(8 * dataSize, littleEndian),
    // level 0 value of arg passed to gl.compressedTexImage3D(,,,,,x,,)
    numberOfArrayElements: headerDataView.getUint32(9 * dataSize, littleEndian),
    // used for texture arrays
    numberOfFaces: headerDataView.getUint32(10 * dataSize, littleEndian),
    // used for cubemap textures, should either be 1 or 6
    numberOfMipmapLevels: headerDataView.getUint32(11 * dataSize, littleEndian),
    // number of levels; disregard possibility of 0 for compressed textures
    bytesOfKeyValueData: headerDataView.getUint32(12 * dataSize, littleEndian),
    // the amount of space after the header for meta-data
    littleEndian
  };
}
function* getImages(header, ktx, littleEndian) {
  const mips = Math.max(1, header.numberOfMipmapLevels);
  const elements = Math.max(1, header.numberOfArrayElements);
  const faces = header.numberOfFaces;
  const depth = Math.max(1, header.pixelDepth);
  let dataOffset = HEADER_LEN + header.bytesOfKeyValueData;
  const imageSizeDenom = faces == 6 && header.numberOfArrayElements == 0 ? 1 : elements * faces * depth;
  const dataView = new DataView(ktx.buffer, ktx.byteOffset);
  for (let mip = 0; mip < mips; mip++) {
    const width = header.pixelWidth >> mip;
    const height = header.pixelHeight >> mip;
    const imageSize = dataView.getInt32(dataOffset, littleEndian);
    dataOffset += 4;
    const imageStride = imageSize / imageSizeDenom;
    console.assert(imageStride % 4 == 0);
    for (let element = 0; element < elements; element++) {
      for (let face = 0; face < faces; face++) {
        for (let z_slice = 0; z_slice < depth; z_slice++) {
          const begin = dataOffset;
          dataOffset += imageStride;
          const end = dataOffset;
          const image = { mip, element, face, width, height, blobRange: [begin, end], buffer: ktx.subarray(begin, end) };
          yield image;
        }
      }
    }
  }
  console.assert(dataOffset == ktx.byteLength);
}
function parseKTX(ktx) {
  const header = parseHeader(ktx);
  const { littleEndian } = header;
  const baseFormat = textureFormatBase[header.glBaseInternalFormat];
  const isArray = header.numberOfArrayElements > 0;
  const isCube = header.numberOfFaces == 6;
  const is3D = header.pixelDepth > 0;
  const hasMips = header.numberOfMipmapLevels > 1;
  const numMips = Math.max(1, header.numberOfMipmapLevels);
  const internalFormat = textureFormatInternal[header.glInternalFormat];
  const kind = isArray ? "TEXTURE_ARRAY" : isCube ? "TEXTURE_CUBE_MAP" : is3D ? "TEXTURE_3D" : "TEXTURE_2D";
  const type = header.glType ? textureDataType[header.glType] : void 0;
  const arrayType = type ? getBufferViewType(type) : Uint8Array;
  const dim = { width: header.pixelWidth, height: header.pixelHeight, ...is3D ? { depth: header.pixelDepth } : void 0 };
  let mips = void 0;
  if (isCube) {
    const images = new Array(numMips).fill(null).map((_) => []);
    for (const image of getImages(header, ktx, littleEndian)) {
      images[image.mip][image.face] = new arrayType(image.buffer.slice().buffer);
    }
    mips = images;
  } else {
    mips = new Array(numMips);
    for (const image of getImages(header, ktx, littleEndian)) {
      mips[image.mip] = new arrayType(image.buffer.slice().buffer);
    }
  }
  const imageData = hasMips ? { mipMaps: mips } : { image: mips[0] };
  return {
    kind,
    internalFormat,
    type,
    ...dim,
    ...imageData
  };
}

// /projects/Novorender/ts/dist/core3d/modules/octree/worker/2_1.ts
var __exports = {};
__export(__exports, {
  MaterialType: () => MaterialType,
  OptionalVertexAttribute: () => OptionalVertexAttribute,
  PrimitiveType: () => PrimitiveType,
  TextureSemantic: () => TextureSemantic,
  readSchema: () => readSchema,
  version: () => version
});
var version = "2.1";
var PrimitiveType = /* @__PURE__ */ ((PrimitiveType3) => {
  PrimitiveType3[PrimitiveType3["points"] = 0] = "points";
  PrimitiveType3[PrimitiveType3["lines"] = 1] = "lines";
  PrimitiveType3[PrimitiveType3["line_loops"] = 2] = "line_loops";
  PrimitiveType3[PrimitiveType3["line_strip"] = 3] = "line_strip";
  PrimitiveType3[PrimitiveType3["triangles"] = 4] = "triangles";
  PrimitiveType3[PrimitiveType3["triangle_strip"] = 5] = "triangle_strip";
  PrimitiveType3[PrimitiveType3["triangle_fan"] = 6] = "triangle_fan";
  return PrimitiveType3;
})(PrimitiveType || {});
var OptionalVertexAttribute = /* @__PURE__ */ ((OptionalVertexAttribute3) => {
  OptionalVertexAttribute3[OptionalVertexAttribute3["normal"] = 1] = "normal";
  OptionalVertexAttribute3[OptionalVertexAttribute3["color"] = 2] = "color";
  OptionalVertexAttribute3[OptionalVertexAttribute3["texCoord"] = 4] = "texCoord";
  OptionalVertexAttribute3[OptionalVertexAttribute3["projectedPos"] = 8] = "projectedPos";
  return OptionalVertexAttribute3;
})(OptionalVertexAttribute || {});
var MaterialType = /* @__PURE__ */ ((MaterialType3) => {
  MaterialType3[MaterialType3["opaque"] = 0] = "opaque";
  MaterialType3[MaterialType3["opaqueDoubleSided"] = 1] = "opaqueDoubleSided";
  MaterialType3[MaterialType3["transparent"] = 2] = "transparent";
  MaterialType3[MaterialType3["elevation"] = 3] = "elevation";
  return MaterialType3;
})(MaterialType || {});
var TextureSemantic = /* @__PURE__ */ ((TextureSemantic3) => {
  TextureSemantic3[TextureSemantic3["baseColor"] = 0] = "baseColor";
  return TextureSemantic3;
})(TextureSemantic || {});
function readSchema(r) {
  const sizes = r.u32(10);
  const flags = r.u8(10);
  const schema = {
    version: "2.1",
    childInfo: {
      length: sizes[0],
      hash: { start: r.u32(sizes[0]), count: r.u32(sizes[0]) },
      childIndex: r.u8(sizes[0]),
      childMask: r.u32(sizes[0]),
      tolerance: r.i8(sizes[0]),
      totalByteSize: r.u32(sizes[0]),
      offset: {
        length: sizes[0],
        x: r.f64(sizes[0]),
        y: r.f64(sizes[0]),
        z: r.f64(sizes[0])
      },
      scale: r.f32(sizes[0]),
      bounds: {
        length: sizes[0],
        box: {
          length: sizes[0],
          min: {
            length: sizes[0],
            x: r.f32(sizes[0]),
            y: r.f32(sizes[0]),
            z: r.f32(sizes[0])
          },
          max: {
            length: sizes[0],
            x: r.f32(sizes[0]),
            y: r.f32(sizes[0]),
            z: r.f32(sizes[0])
          }
        },
        sphere: {
          length: sizes[0],
          origo: {
            length: sizes[0],
            x: r.f32(sizes[0]),
            y: r.f32(sizes[0]),
            z: r.f32(sizes[0])
          },
          radius: r.f32(sizes[0])
        }
      },
      subMeshes: { start: r.u32(sizes[0]), count: r.u32(sizes[0]) },
      descendantObjectIds: { start: r.u32(sizes[0]), count: r.u32(sizes[0]) }
    },
    hashBytes: r.u8(sizes[1]),
    descendantObjectIds: r.u32(sizes[2]),
    subMeshProjection: {
      length: sizes[3],
      objectId: r.u32(sizes[3]),
      primitiveType: r.u8(sizes[3]),
      attributes: r.u8(sizes[3]),
      numDeviations: r.u8(sizes[3]),
      numIndices: r.u32(sizes[3]),
      numVertices: r.u32(sizes[3]),
      numTextureBytes: r.u32(sizes[3])
    },
    subMesh: {
      length: sizes[4],
      childIndex: r.u8(sizes[4]),
      objectId: r.u32(sizes[4]),
      materialIndex: r.u8(sizes[4]),
      primitiveType: r.u8(sizes[4]),
      materialType: r.u8(sizes[4]),
      attributes: r.u8(sizes[4]),
      numDeviations: r.u8(sizes[4]),
      vertices: { start: r.u32(sizes[4]), count: r.u32(sizes[4]) },
      primitiveVertexIndices: { start: r.u32(sizes[4]), count: r.u32(sizes[4]) },
      edgeVertexIndices: { start: r.u32(sizes[4]), count: r.u32(sizes[4]) },
      cornerVertexIndices: { start: r.u32(sizes[4]), count: r.u32(sizes[4]) },
      textures: { start: r.u8(sizes[4]), count: r.u8(sizes[4]) }
    },
    textureInfo: {
      length: sizes[5],
      semantic: r.u8(sizes[5]),
      transform: {
        length: sizes[5],
        e00: r.f32(sizes[5]),
        e01: r.f32(sizes[5]),
        e02: r.f32(sizes[5]),
        e10: r.f32(sizes[5]),
        e11: r.f32(sizes[5]),
        e12: r.f32(sizes[5]),
        e20: r.f32(sizes[5]),
        e21: r.f32(sizes[5]),
        e22: r.f32(sizes[5])
      },
      pixelRange: { start: r.u32(sizes[5]), count: r.u32(sizes[5]) }
    },
    vertex: {
      length: sizes[6],
      position: {
        length: sizes[6],
        x: r.i16(sizes[6]),
        y: r.i16(sizes[6]),
        z: r.i16(sizes[6])
      },
      normal: !flags[0] ? void 0 : {
        length: sizes[6],
        x: r.i8(sizes[6]),
        y: r.i8(sizes[6]),
        z: r.i8(sizes[6])
      },
      color: !flags[1] ? void 0 : {
        length: sizes[6],
        red: r.u8(sizes[6]),
        green: r.u8(sizes[6]),
        blue: r.u8(sizes[6]),
        alpha: r.u8(sizes[6])
      },
      texCoord: !flags[2] ? void 0 : {
        length: sizes[6],
        x: r.f16(sizes[6]),
        y: r.f16(sizes[6])
      },
      projectedPos: !flags[3] ? void 0 : {
        length: sizes[6],
        x: r.i16(sizes[6]),
        y: r.i16(sizes[6]),
        z: r.i16(sizes[6])
      },
      deviations: {
        length: sizes[6],
        a: !flags[4] ? void 0 : r.f16(sizes[6]),
        b: !flags[5] ? void 0 : r.f16(sizes[6]),
        c: !flags[6] ? void 0 : r.f16(sizes[6]),
        d: !flags[7] ? void 0 : r.f16(sizes[6])
      }
    },
    triangle: {
      length: sizes[7],
      topologyFlags: !flags[8] ? void 0 : r.u8(sizes[7])
    },
    vertexIndex: !flags[9] ? void 0 : r.u16(sizes[8]),
    texturePixels: r.u8(sizes[9])
  };
  console.assert(r.eof);
  return schema;
}

// /projects/Novorender/ts/dist/core3d/modules/octree/worker/2_0.ts
var version2 = "2.0";
function readSchema2(r) {
  const sizes = r.u32(9);
  const flags = r.u8(10);
  const schema = {
    version: "2.0",
    childInfo: {
      length: sizes[0],
      hash: { start: r.u32(sizes[0]), count: r.u32(sizes[0]) },
      childIndex: r.u8(sizes[0]),
      childMask: r.u32(sizes[0]),
      tolerance: r.i8(sizes[0]),
      totalByteSize: r.u32(sizes[0]),
      offset: {
        length: sizes[0],
        x: r.f64(sizes[0]),
        y: r.f64(sizes[0]),
        z: r.f64(sizes[0])
      },
      scale: r.f32(sizes[0]),
      bounds: {
        length: sizes[0],
        box: {
          length: sizes[0],
          min: {
            length: sizes[0],
            x: r.f32(sizes[0]),
            y: r.f32(sizes[0]),
            z: r.f32(sizes[0])
          },
          max: {
            length: sizes[0],
            x: r.f32(sizes[0]),
            y: r.f32(sizes[0]),
            z: r.f32(sizes[0])
          }
        },
        sphere: {
          length: sizes[0],
          origo: {
            length: sizes[0],
            x: r.f32(sizes[0]),
            y: r.f32(sizes[0]),
            z: r.f32(sizes[0])
          },
          radius: r.f32(sizes[0])
        }
      },
      subMeshes: { start: r.u32(sizes[0]), count: r.u32(sizes[0]) }
    },
    hashBytes: r.u8(sizes[1]),
    subMeshProjection: {
      length: sizes[2],
      objectId: r.u32(sizes[2]),
      primitiveType: r.u8(sizes[2]),
      attributes: r.u8(sizes[2]),
      numDeviations: r.u8(sizes[2]),
      numIndices: r.u32(sizes[2]),
      numVertices: r.u32(sizes[2]),
      numTextureBytes: r.u32(sizes[2])
    },
    subMesh: {
      length: sizes[3],
      childIndex: r.u8(sizes[3]),
      objectId: r.u32(sizes[3]),
      materialIndex: r.u8(sizes[3]),
      primitiveType: r.u8(sizes[3]),
      materialType: r.u8(sizes[3]),
      attributes: r.u8(sizes[3]),
      numDeviations: r.u8(sizes[3]),
      vertices: { start: r.u32(sizes[3]), count: r.u32(sizes[3]) },
      primitiveVertexIndices: { start: r.u32(sizes[3]), count: r.u32(sizes[3]) },
      edgeVertexIndices: { start: r.u32(sizes[3]), count: r.u32(sizes[3]) },
      cornerVertexIndices: { start: r.u32(sizes[3]), count: r.u32(sizes[3]) },
      textures: { start: r.u8(sizes[3]), count: r.u8(sizes[3]) }
    },
    textureInfo: {
      length: sizes[4],
      semantic: r.u8(sizes[4]),
      transform: {
        length: sizes[4],
        e00: r.f32(sizes[4]),
        e01: r.f32(sizes[4]),
        e02: r.f32(sizes[4]),
        e10: r.f32(sizes[4]),
        e11: r.f32(sizes[4]),
        e12: r.f32(sizes[4]),
        e20: r.f32(sizes[4]),
        e21: r.f32(sizes[4]),
        e22: r.f32(sizes[4])
      },
      pixelRange: { start: r.u32(sizes[4]), count: r.u32(sizes[4]) }
    },
    vertex: {
      length: sizes[5],
      position: {
        length: sizes[5],
        x: r.i16(sizes[5]),
        y: r.i16(sizes[5]),
        z: r.i16(sizes[5])
      },
      normal: !flags[0] ? void 0 : {
        length: sizes[5],
        x: r.i8(sizes[5]),
        y: r.i8(sizes[5]),
        z: r.i8(sizes[5])
      },
      color: !flags[1] ? void 0 : {
        length: sizes[5],
        red: r.u8(sizes[5]),
        green: r.u8(sizes[5]),
        blue: r.u8(sizes[5]),
        alpha: r.u8(sizes[5])
      },
      texCoord: !flags[2] ? void 0 : {
        length: sizes[5],
        x: r.f16(sizes[5]),
        y: r.f16(sizes[5])
      },
      projectedPos: !flags[3] ? void 0 : {
        length: sizes[5],
        x: r.i16(sizes[5]),
        y: r.i16(sizes[5]),
        z: r.i16(sizes[5])
      },
      deviations: {
        length: sizes[5],
        a: !flags[4] ? void 0 : r.f16(sizes[5]),
        b: !flags[5] ? void 0 : r.f16(sizes[5]),
        c: !flags[6] ? void 0 : r.f16(sizes[5]),
        d: !flags[7] ? void 0 : r.f16(sizes[5])
      }
    },
    triangle: {
      length: sizes[6],
      topologyFlags: !flags[8] ? void 0 : r.u8(sizes[6])
    },
    vertexIndex: !flags[9] ? void 0 : r.u16(sizes[7]),
    texturePixels: r.u8(sizes[8])
  };
  console.assert(r.eof);
  return schema;
}

// /projects/Novorender/ts/dist/core3d/modules/octree/worker/parser.ts
var { MaterialType: MaterialType2, OptionalVertexAttribute: OptionalVertexAttribute2, PrimitiveType: PrimitiveType2, TextureSemantic: TextureSemantic2 } = __exports;
function isCurrentSchema(schema) {
  return schema.version == version;
}
function isSupportedVersion(version3) {
  return version3 == version || version3 == version2;
}
var primitiveTypeStrings = ["POINTS", "LINES", "LINE_LOOP", "LINE_STRIP", "TRIANGLES", "TRIANGLE_STRIP", "TRIANGLE_FAN"];
function getVec3(v, i) {
  return vec3_exports.fromValues(v.x[i], v.y[i], v.z[i]);
}
function getRange(v, i) {
  const begin = v.start[i];
  const end = begin + v.count[i];
  return [begin, end];
}
function computePrimitiveCount(primitiveType, numIndices) {
  switch (primitiveType) {
    case PrimitiveType2.points:
      return numIndices;
    case PrimitiveType2.lines:
      return numIndices / 2;
    case PrimitiveType2.line_loops:
      return numIndices;
    case PrimitiveType2.line_strip:
      return numIndices - 1;
    case PrimitiveType2.triangles:
      return numIndices / 3;
    case PrimitiveType2.triangle_strip:
      return numIndices - 2;
    case PrimitiveType2.triangle_fan:
      return numIndices - 2;
    default:
      console.warn(`Unknown primitive type: ${primitiveType}!`);
  }
}
function getVertexAttribs(deviations) {
  return {
    position: { type: Uint16Array, components: ["x", "y", "z"] },
    normal: { type: Int8Array, components: ["x", "y", "z"] },
    texCoord: { type: Float16Array, components: ["x", "y"] },
    color: { type: Uint8Array, components: ["red", "green", "blue", "alpha"] },
    projectedPos: { type: Uint16Array, components: ["x", "y", "z"] },
    deviations: { type: Float16Array, components: ["a", "b", "c", "d"].slice(0, deviations) },
    materialIndex: { type: Uint8Array },
    objectId: { type: Uint32Array }
  };
}
function computeVertexOffsets(attribs, deviations = 0) {
  let offset = 0;
  let offsets = {};
  function alignOffset(alignment) {
    const padding = alignment - 1 - (offset + alignment - 1) % alignment;
    offset += padding;
  }
  let maxAlign = 1;
  const vertexAttribs = getVertexAttribs(deviations);
  for (const attrib of attribs) {
    const { type, components } = vertexAttribs[attrib];
    const count = components?.length ?? 1;
    maxAlign = Math.max(maxAlign, type.BYTES_PER_ELEMENT);
    alignOffset(type.BYTES_PER_ELEMENT);
    offsets[attrib] = offset;
    offset += type.BYTES_PER_ELEMENT * count;
  }
  alignOffset(maxAlign);
  offsets.stride = offset;
  return offsets;
}
function getVertexAttribNames(optionalAttributes, deviations, hasMaterials, hasObjectIds) {
  const attribNames = ["position"];
  if (optionalAttributes & OptionalVertexAttribute2.normal)
    attribNames.push("normal");
  if (optionalAttributes & OptionalVertexAttribute2.texCoord)
    attribNames.push("texCoord");
  if (optionalAttributes & OptionalVertexAttribute2.color)
    attribNames.push("color");
  if (optionalAttributes & OptionalVertexAttribute2.projectedPos)
    attribNames.push("projectedPos");
  if (deviations > 0)
    attribNames.push("deviations");
  if (hasMaterials) {
    attribNames.push("materialIndex");
  }
  if (hasObjectIds) {
    attribNames.push("objectId");
  }
  return attribNames;
}
function aggregateSubMeshProjections(subMeshProjection, range, separatePositionBuffer, predicate) {
  let primitives = 0;
  let totalTextureBytes = 0;
  let totalNumIndices = 0;
  let totalNumVertices = 0;
  let totalNumVertexBytes = 0;
  const [begin, end] = range;
  for (let i = begin; i < end; i++) {
    const objectId = subMeshProjection.objectId[i];
    if (predicate?.(objectId) ?? true) {
      const indices = subMeshProjection.numIndices[i];
      const vertices = subMeshProjection.numVertices[i];
      const textureBytes = subMeshProjection.numTextureBytes[i];
      const attributes = subMeshProjection.attributes[i];
      const deviations = subMeshProjection.numDeviations[i];
      const primitiveType = subMeshProjection.primitiveType[i];
      const hasMaterials = textureBytes == 0;
      const hasObjectIds = true;
      const [pos, ...rest] = getVertexAttribNames(attributes, deviations, hasMaterials, hasObjectIds);
      const numBytesPerVertex = separatePositionBuffer ? computeVertexOffsets([pos]).stride + computeVertexOffsets(rest, deviations).stride : computeVertexOffsets([pos, ...rest], deviations).stride;
      primitives += computePrimitiveCount(primitiveType, indices ? indices : vertices) ?? 0;
      totalNumIndices += indices;
      totalNumVertices += vertices;
      totalNumVertexBytes += vertices * numBytesPerVertex;
      totalTextureBytes += textureBytes;
    } else {
    }
  }
  const idxStride = totalNumVertices < 65535 ? 2 : 4;
  const gpuBytes = totalTextureBytes + totalNumVertexBytes + totalNumIndices * idxStride;
  return { primitives, gpuBytes };
}
function toHex(bytes) {
  return Array.prototype.map.call(bytes, (x) => ("00" + x.toString(16).toUpperCase()).slice(-2)).join("");
}
function getChildren(parentId, schema, separatePositionBuffer, predicate) {
  const { childInfo, hashBytes } = schema;
  const children = [];
  const parentPrimitiveCounts = [];
  for (let i = 0; i < childInfo.length; i++) {
    const childIndex = childInfo.childIndex[i];
    const childMask = childInfo.childMask[i];
    const [hashBegin, hashEnd] = getRange(childInfo.hash, i);
    const hash = hashBytes.slice(hashBegin, hashEnd);
    const id = toHex(hash);
    const tolerance = childInfo.tolerance[i];
    const byteSize = childInfo.totalByteSize[i];
    const offset = getVec3(childInfo.offset, i);
    const scale2 = childInfo.scale[i];
    const bounds = {
      box: {
        min: getVec3(childInfo.bounds.box.min, i),
        max: getVec3(childInfo.bounds.box.max, i)
      },
      sphere: {
        center: getVec3(childInfo.bounds.sphere.origo, i),
        radius: childInfo.bounds.sphere.radius[i]
      }
    };
    const { sphere, box } = bounds;
    vec3_exports.add(sphere.center, sphere.center, offset);
    vec3_exports.add(box.min, box.min, offset);
    vec3_exports.add(box.max, box.max, offset);
    const subMeshProjectionRange = getRange(childInfo.subMeshes, i);
    const parentPrimitives = parentPrimitiveCounts[childIndex];
    const { primitives, gpuBytes } = aggregateSubMeshProjections(schema.subMeshProjection, subMeshProjectionRange, separatePositionBuffer, predicate);
    const primitivesDelta = primitives - (parentPrimitives ?? 0);
    let descendantObjectIds;
    if (isCurrentSchema(schema)) {
      const [idsBegin, idsEnd] = getRange(schema.childInfo.descendantObjectIds, i);
      if (idsBegin != idsEnd) {
        descendantObjectIds = [...schema.descendantObjectIds.slice(idsBegin, idsEnd)];
      }
    }
    children.push({ id, childIndex, childMask, tolerance, byteSize, offset, scale: scale2, bounds, primitives, primitivesDelta, gpuBytes, descendantObjectIds });
  }
  return children;
}
function* getSubMeshes(schema, predicate) {
  const { subMesh } = schema;
  for (let i = 0; i < subMesh.length; i++) {
    const objectId = subMesh.objectId[i];
    const primitive = subMesh.primitiveType[i];
    if (predicate?.(objectId) ?? true) {
      const childIndex = subMesh.childIndex[i];
      const objectId2 = subMesh.objectId[i];
      const materialIndex = subMesh.materialIndex[i];
      const materialType = materialIndex == 255 && subMesh.textures.count[i] == 0 && (primitive == PrimitiveType2.triangle_strip || primitive == PrimitiveType2.triangles) ? MaterialType2.elevation : subMesh.materialType[i];
      const primitiveType = subMesh.primitiveType[i];
      const attributes = subMesh.attributes[i];
      const deviations = subMesh.numDeviations[i];
      const vertexRange = getRange(subMesh.vertices, i);
      const indexRange = getRange(subMesh.primitiveVertexIndices, i);
      const textureRange = getRange(subMesh.textures, i);
      yield { childIndex, objectId: objectId2, materialIndex, materialType, primitiveType, attributes, deviations, vertexRange, indexRange, textureRange };
    }
  }
}
function copyToInterleavedArray(wasm2, dst, src, byteOffset, byteStride, begin, end) {
  const offset = byteOffset / dst.BYTES_PER_ELEMENT;
  const stride = byteStride / dst.BYTES_PER_ELEMENT;
  console.assert(Math.round(offset) == offset);
  console.assert(Math.round(stride) == stride);
  let j = offset;
  for (let i = begin; i < end; i++) {
    dst[j] = src[i];
    j += stride;
  }
}
function fillToInterleavedArray(wasm2, dst, src, byteOffset, byteStride, begin, end) {
  const offset = byteOffset / dst.BYTES_PER_ELEMENT;
  const stride = byteStride / dst.BYTES_PER_ELEMENT;
  console.assert(Math.round(offset) == offset);
  console.assert(Math.round(stride) == stride);
  let j = offset;
  for (let i = begin; i < end; i++) {
    dst[j] = src;
    j += stride;
  }
}
function getGeometry(wasm2, schema, separatePositionBuffer, enableOutlines, highlights, predicate) {
  const { vertex, vertexIndex } = schema;
  const filteredSubMeshes = [...getSubMeshes(schema, predicate)];
  let subMeshes = [];
  const referencedTextures = /* @__PURE__ */ new Set();
  const groups = /* @__PURE__ */ new Map();
  for (let i = 0; i < filteredSubMeshes.length; i++) {
    const { materialType, primitiveType, attributes, deviations, childIndex } = filteredSubMeshes[i];
    const key = `${materialType}_${primitiveType}_${attributes}_${deviations}_${childIndex}`;
    let group = groups.get(key);
    if (!group) {
      group = { materialType, primitiveType, attributes, deviations, subMeshIndices: [] };
      groups.set(key, group);
    }
    group.subMeshIndices.push(i);
  }
  highlights.mutex.lockSync();
  for (const { materialType, primitiveType, attributes, deviations, subMeshIndices } of groups.values()) {
    let enumerateBuffers2 = function(possibleBuffers) {
      const buffers = [];
      const indices2 = {};
      for (const [key, value] of Object.entries(possibleBuffers)) {
        const buffer = value;
        let index = -1;
        if (buffer) {
          index = buffers.indexOf(buffer);
          if (index < 0) {
            index = buffers.length;
            buffers.push(buffer);
          }
        }
        Reflect.set(indices2, key, index);
      }
      return [buffers, indices2];
    };
    var enumerateBuffers = enumerateBuffers2;
    if (subMeshIndices.length == 0)
      continue;
    const groupMeshes = subMeshIndices.map((i) => filteredSubMeshes[i]);
    const hasMaterials = groupMeshes.some((m) => m.materialIndex != 255);
    const hasObjectIds = groupMeshes.some((m) => m.objectId != 4294967295);
    const allAttribNames = getVertexAttribNames(attributes, deviations, hasMaterials, hasObjectIds);
    const [posName, ...extraAttribNames] = allAttribNames;
    const attribNames = separatePositionBuffer ? extraAttribNames : allAttribNames;
    const positionStride = computeVertexOffsets([posName], deviations).stride;
    const trianglePosStride = positionStride * 3;
    const attribOffsets = computeVertexOffsets(attribNames, deviations);
    const vertexStride = attribOffsets.stride;
    const childIndices = [...new Set(groupMeshes.map((sm) => sm.childIndex))].sort();
    let numVertices = 0;
    let numIndices = 0;
    let numTriangles = 0;
    for (let i = 0; i < groupMeshes.length; i++) {
      const sm = groupMeshes[i];
      const vtxCnt = sm.vertexRange[1] - sm.vertexRange[0];
      const idxCnt = sm.indexRange[1] - sm.indexRange[0];
      numVertices += vtxCnt;
      numIndices += idxCnt;
      if (primitiveType == PrimitiveType2.triangles) {
        numTriangles += Math.round((idxCnt > 0 ? idxCnt : vtxCnt) / 3);
      }
    }
    const vertexBuffer = new ArrayBuffer(numVertices * vertexStride);
    const positionBuffer = separatePositionBuffer ? new ArrayBuffer(numVertices * positionStride) : void 0;
    let indexBuffer;
    if (vertexIndex) {
      indexBuffer = new (numVertices < 65535 ? Uint16Array : Uint32Array)(numIndices);
    }
    const highlightBuffer = new Uint8Array(numVertices);
    let indexOffset = 0;
    let vertexOffset = 0;
    let triangleOffset = 0;
    let drawRanges = [];
    const objectRanges = [];
    const [vertexBuffers, bufIdx] = enumerateBuffers2({
      primary: vertexBuffer,
      highlight: highlightBuffer?.buffer,
      pos: positionBuffer
    });
    for (const childIndex of childIndices) {
      const meshes = groupMeshes.filter((sm) => sm.childIndex == childIndex);
      if (meshes.length == 0)
        continue;
      const drawRangeBegin = indexBuffer ? indexOffset : vertexOffset;
      for (const subMesh of meshes) {
        const { vertexRange, indexRange, materialIndex, deviations: deviations2, objectId } = subMesh;
        const context = { materialIndex, objectId };
        const [beginVtx, endVtx] = vertexRange;
        const [beginIdx, endIdx] = indexRange;
        const vertexAttribs = getVertexAttribs(deviations2);
        for (const attribName of attribNames) {
          const { type, components } = vertexAttribs[attribName];
          const dst = new type(vertexBuffer, vertexOffset * vertexStride);
          const count2 = components?.length ?? 1;
          for (var c = 0; c < count2; c++) {
            const offs = attribOffsets[attribName] + c * type.BYTES_PER_ELEMENT;
            if (attribName in vertex) {
              let src = Reflect.get(vertex, attribName);
              if (components) {
                src = Reflect.get(src, components[c]);
              }
              copyToInterleavedArray(wasm2, dst, src, offs, vertexStride, beginVtx, endVtx);
            } else {
              const src = Reflect.get(context, attribName);
              fillToInterleavedArray(wasm2, dst, src, offs, vertexStride, beginVtx, endVtx);
            }
          }
        }
        const numTrianglesInSubMesh = vertexIndex && indexBuffer ? (endIdx - beginIdx) / 3 : (endVtx - beginVtx) / 3;
        if (positionBuffer) {
          const i16 = new Int16Array(positionBuffer, vertexOffset * positionStride);
          copyToInterleavedArray(wasm2, i16, vertex.position.x, 0, positionStride, beginVtx, endVtx);
          copyToInterleavedArray(wasm2, i16, vertex.position.y, 2, positionStride, beginVtx, endVtx);
          copyToInterleavedArray(wasm2, i16, vertex.position.z, 4, positionStride, beginVtx, endVtx);
        }
        if (vertexIndex && indexBuffer) {
          for (let i = beginIdx; i < endIdx; i++) {
            indexBuffer[indexOffset++] = vertexIndex[i] + vertexOffset;
          }
        }
        const endVertex = vertexOffset + (endVtx - beginVtx);
        const endTriangle = triangleOffset + (endIdx - beginIdx) / 3;
        const highlightIndex = highlights.indices[objectId] ?? 0;
        if (highlightIndex) {
          highlightBuffer.fill(highlightIndex, vertexOffset, endVertex);
        }
        const prev = objectRanges.length - 1;
        if (prev >= 0 && objectRanges[prev].objectId == objectId) {
          objectRanges[prev].endVertex = endVertex;
          objectRanges[prev].endTriangle = endTriangle;
        } else {
          objectRanges.push({ objectId, beginVertex: vertexOffset, endVertex, beginTriangle: triangleOffset, endTriangle });
        }
        triangleOffset += numTrianglesInSubMesh;
        vertexOffset += endVtx - beginVtx;
      }
      const drawRangeEnd = indexBuffer ? indexOffset : vertexOffset;
      const byteOffset = drawRangeBegin * (indexBuffer ? indexBuffer.BYTES_PER_ELEMENT : vertexStride);
      const count = drawRangeEnd - drawRangeBegin;
      drawRanges.push({ childIndex, byteOffset, first: drawRangeBegin, count });
    }
    console.assert(vertexOffset == numVertices);
    console.assert(indexOffset == numIndices);
    const indices = indexBuffer ?? numVertices;
    const [beginTexture, endTexture] = groupMeshes[0].textureRange;
    let baseColorTexture;
    if (endTexture > beginTexture) {
      baseColorTexture = beginTexture;
    }
    if (baseColorTexture != void 0) {
      referencedTextures.add(baseColorTexture);
    }
    const stride = vertexStride;
    const deviationsKind = deviations == 0 || deviations == 1 ? "FLOAT" : `FLOAT_VEC${deviations}`;
    const vertexAttributes = {
      position: { kind: "FLOAT_VEC4", buffer: bufIdx.pos, componentCount: 3, componentType: "SHORT", normalized: true, byteOffset: attribOffsets["position"], byteStride: separatePositionBuffer ? 0 : stride },
      normal: (attributes & OptionalVertexAttribute2.normal) != 0 ? { kind: "FLOAT_VEC3", buffer: bufIdx.primary, componentCount: 3, componentType: "BYTE", normalized: true, byteOffset: attribOffsets["normal"], byteStride: stride } : null,
      material: hasMaterials ? { kind: "UNSIGNED_INT", buffer: bufIdx.primary, componentCount: 1, componentType: "UNSIGNED_BYTE", normalized: false, byteOffset: attribOffsets["materialIndex"], byteStride: stride } : null,
      objectId: hasObjectIds ? { kind: "UNSIGNED_INT", buffer: bufIdx.primary, componentCount: 1, componentType: "UNSIGNED_INT", normalized: false, byteOffset: attribOffsets["objectId"], byteStride: stride } : null,
      texCoord: (attributes & OptionalVertexAttribute2.texCoord) != 0 ? { kind: "FLOAT_VEC2", buffer: bufIdx.primary, componentCount: 2, componentType: "HALF_FLOAT", normalized: false, byteOffset: attribOffsets["texCoord"], byteStride: stride } : null,
      color: (attributes & OptionalVertexAttribute2.color) != 0 ? { kind: "FLOAT_VEC4", buffer: bufIdx.primary, componentCount: 4, componentType: "UNSIGNED_BYTE", normalized: true, byteOffset: attribOffsets["color"], byteStride: stride } : null,
      projectedPos: (attributes & OptionalVertexAttribute2.projectedPos) != 0 ? { kind: "FLOAT_VEC4", buffer: bufIdx.primary, componentCount: 3, componentType: "SHORT", normalized: true, byteOffset: attribOffsets["projectedPos"], byteStride: stride } : null,
      deviations: deviations != 0 ? { kind: deviationsKind, buffer: bufIdx.primary, componentCount: deviations, componentType: "HALF_FLOAT", normalized: false, byteOffset: attribOffsets["deviations"], byteStride: stride } : null,
      highlight: { kind: "UNSIGNED_INT", buffer: bufIdx.highlight, componentCount: 1, componentType: "UNSIGNED_BYTE", normalized: false, byteOffset: 0, byteStride: 0 }
    };
    objectRanges.sort((a, b) => a.objectId - b.objectId);
    subMeshes.push({
      materialType,
      primitiveType: primitiveTypeStrings[primitiveType],
      numVertices,
      numTriangles,
      objectRanges,
      vertexAttributes,
      vertexBuffers,
      indices,
      baseColorTexture,
      drawRanges
    });
  }
  highlights.mutex.unlock();
  const textures = new Array(schema.textureInfo.length);
  const { textureInfo } = schema;
  for (const i of referencedTextures) {
    const [begin, end] = getRange(textureInfo.pixelRange, i);
    const semantic = textureInfo.semantic[i];
    const transform = [
      textureInfo.transform.e00[i],
      textureInfo.transform.e01[i],
      textureInfo.transform.e02[i],
      textureInfo.transform.e10[i],
      textureInfo.transform.e11[i],
      textureInfo.transform.e12[i],
      textureInfo.transform.e20[i],
      textureInfo.transform.e21[i],
      textureInfo.transform.e22[i]
    ];
    const ktx = schema.texturePixels.subarray(begin, end);
    const params = parseKTX(ktx);
    textures[i] = { semantic, transform, params };
  }
  return { subMeshes, textures };
}
function parseNode(wasm2, id, separatePositionBuffer, enableOutlines, version3, buffer, highlights, applyFilter) {
  console.assert(isSupportedVersion(version3));
  const r = new BufferReader(buffer);
  var schema = version3 == version ? readSchema(r) : readSchema2(r);
  let predicate;
  predicate = applyFilter ? (objectId) => highlights.indices[objectId] != 255 : void 0;
  const childInfos = getChildren(id, schema, separatePositionBuffer, predicate);
  const geometry = getGeometry(wasm2, schema, separatePositionBuffer, enableOutlines, highlights, predicate);
  return { childInfos, geometry };
}

// /projects/Novorender/ts/node_modules/@novorender/wasm-parser/wasm_parser_bg.js
var wasm_parser_bg_exports = {};
__export(wasm_parser_bg_exports, {
  __wbg_set_wasm: () => __wbg_set_wasm,
  __wbindgen_copy_to_typed_array: () => __wbindgen_copy_to_typed_array,
  __wbindgen_object_drop_ref: () => __wbindgen_object_drop_ref,
  copy_to_interleaved_array_f32: () => copy_to_interleaved_array_f32,
  copy_to_interleaved_array_f64: () => copy_to_interleaved_array_f64,
  copy_to_interleaved_array_i16: () => copy_to_interleaved_array_i16,
  copy_to_interleaved_array_i32: () => copy_to_interleaved_array_i32,
  copy_to_interleaved_array_i8: () => copy_to_interleaved_array_i8,
  copy_to_interleaved_array_u16: () => copy_to_interleaved_array_u16,
  copy_to_interleaved_array_u32: () => copy_to_interleaved_array_u32,
  copy_to_interleaved_array_u8: () => copy_to_interleaved_array_u8,
  fill_to_interleaved_array_f32: () => fill_to_interleaved_array_f32,
  fill_to_interleaved_array_f64: () => fill_to_interleaved_array_f64,
  fill_to_interleaved_array_i16: () => fill_to_interleaved_array_i16,
  fill_to_interleaved_array_i32: () => fill_to_interleaved_array_i32,
  fill_to_interleaved_array_i8: () => fill_to_interleaved_array_i8,
  fill_to_interleaved_array_u16: () => fill_to_interleaved_array_u16,
  fill_to_interleaved_array_u32: () => fill_to_interleaved_array_u32,
  fill_to_interleaved_array_u8: () => fill_to_interleaved_array_u8,
  init: () => init
});
var wasm;
function __wbg_set_wasm(val) {
  wasm = val;
}
var cachedUint8Memory0 = null;
function getUint8Memory0() {
  if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
    cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8Memory0;
}
function getArrayU8FromWasm0(ptr, len2) {
  ptr = ptr >>> 0;
  return getUint8Memory0().subarray(ptr / 1, ptr / 1 + len2);
}
var heap = new Array(128).fill(void 0);
heap.push(void 0, null, true, false);
function getObject(idx) {
  return heap[idx];
}
var heap_next = heap.length;
function dropObject(idx) {
  if (idx < 132)
    return;
  heap[idx] = heap_next;
  heap_next = idx;
}
function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}
function init() {
  wasm.init();
}
var WASM_VECTOR_LEN = 0;
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8Memory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function addHeapObject(obj) {
  if (heap_next === heap.length)
    heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];
  heap[idx] = obj;
  return idx;
}
function copy_to_interleaved_array_u8(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray8ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray8ToWasm0(src, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  wasm.copy_to_interleaved_array_i8(ptr0, len0, addHeapObject(dst), ptr1, len1, byte_offset, byte_stride, begin, end);
}
var cachedUint16Memory0 = null;
function getUint16Memory0() {
  if (cachedUint16Memory0 === null || cachedUint16Memory0.byteLength === 0) {
    cachedUint16Memory0 = new Uint16Array(wasm.memory.buffer);
  }
  return cachedUint16Memory0;
}
function passArray16ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 2, 2) >>> 0;
  getUint16Memory0().set(arg, ptr / 2);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function copy_to_interleaved_array_u16(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray16ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray16ToWasm0(src, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  wasm.copy_to_interleaved_array_i16(ptr0, len0, addHeapObject(dst), ptr1, len1, byte_offset, byte_stride, begin, end);
}
var cachedUint32Memory0 = null;
function getUint32Memory0() {
  if (cachedUint32Memory0 === null || cachedUint32Memory0.byteLength === 0) {
    cachedUint32Memory0 = new Uint32Array(wasm.memory.buffer);
  }
  return cachedUint32Memory0;
}
function passArray32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0;
  getUint32Memory0().set(arg, ptr / 4);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function copy_to_interleaved_array_u32(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray32ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray32ToWasm0(src, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  wasm.copy_to_interleaved_array_i32(ptr0, len0, addHeapObject(dst), ptr1, len1, byte_offset, byte_stride, begin, end);
}
function copy_to_interleaved_array_i8(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray8ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray8ToWasm0(src, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  wasm.copy_to_interleaved_array_i8(ptr0, len0, addHeapObject(dst), ptr1, len1, byte_offset, byte_stride, begin, end);
}
function copy_to_interleaved_array_i16(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray16ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray16ToWasm0(src, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  wasm.copy_to_interleaved_array_i16(ptr0, len0, addHeapObject(dst), ptr1, len1, byte_offset, byte_stride, begin, end);
}
function copy_to_interleaved_array_i32(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray32ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray32ToWasm0(src, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  wasm.copy_to_interleaved_array_i32(ptr0, len0, addHeapObject(dst), ptr1, len1, byte_offset, byte_stride, begin, end);
}
var cachedFloat32Memory0 = null;
function getFloat32Memory0() {
  if (cachedFloat32Memory0 === null || cachedFloat32Memory0.byteLength === 0) {
    cachedFloat32Memory0 = new Float32Array(wasm.memory.buffer);
  }
  return cachedFloat32Memory0;
}
function passArrayF32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0;
  getFloat32Memory0().set(arg, ptr / 4);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function copy_to_interleaved_array_f32(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArrayF32ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  const ptr1 = passArrayF32ToWasm0(src, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  wasm.copy_to_interleaved_array_f32(ptr0, len0, addHeapObject(dst), ptr1, len1, byte_offset, byte_stride, begin, end);
}
var cachedFloat64Memory0 = null;
function getFloat64Memory0() {
  if (cachedFloat64Memory0 === null || cachedFloat64Memory0.byteLength === 0) {
    cachedFloat64Memory0 = new Float64Array(wasm.memory.buffer);
  }
  return cachedFloat64Memory0;
}
function passArrayF64ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 8, 8) >>> 0;
  getFloat64Memory0().set(arg, ptr / 8);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function copy_to_interleaved_array_f64(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArrayF64ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  const ptr1 = passArrayF64ToWasm0(src, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  wasm.copy_to_interleaved_array_f64(ptr0, len0, addHeapObject(dst), ptr1, len1, byte_offset, byte_stride, begin, end);
}
function fill_to_interleaved_array_u8(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray8ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  wasm.fill_to_interleaved_array_i8(ptr0, len0, addHeapObject(dst), src, byte_offset, byte_stride, begin, end);
}
function fill_to_interleaved_array_u16(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray16ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  wasm.fill_to_interleaved_array_i16(ptr0, len0, addHeapObject(dst), src, byte_offset, byte_stride, begin, end);
}
function fill_to_interleaved_array_u32(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray32ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  wasm.fill_to_interleaved_array_i32(ptr0, len0, addHeapObject(dst), src, byte_offset, byte_stride, begin, end);
}
function fill_to_interleaved_array_i8(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray8ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  wasm.fill_to_interleaved_array_i8(ptr0, len0, addHeapObject(dst), src, byte_offset, byte_stride, begin, end);
}
function fill_to_interleaved_array_i16(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray16ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  wasm.fill_to_interleaved_array_i16(ptr0, len0, addHeapObject(dst), src, byte_offset, byte_stride, begin, end);
}
function fill_to_interleaved_array_i32(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArray32ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  wasm.fill_to_interleaved_array_i32(ptr0, len0, addHeapObject(dst), src, byte_offset, byte_stride, begin, end);
}
function fill_to_interleaved_array_f32(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArrayF32ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  wasm.fill_to_interleaved_array_f32(ptr0, len0, addHeapObject(dst), src, byte_offset, byte_stride, begin, end);
}
function fill_to_interleaved_array_f64(dst, src, byte_offset, byte_stride, begin, end) {
  var ptr0 = passArrayF64ToWasm0(dst, wasm.__wbindgen_malloc);
  var len0 = WASM_VECTOR_LEN;
  wasm.fill_to_interleaved_array_f64(ptr0, len0, addHeapObject(dst), src, byte_offset, byte_stride, begin, end);
}
function __wbindgen_copy_to_typed_array(arg0, arg1, arg2) {
  new Uint8Array(getObject(arg2).buffer, getObject(arg2).byteOffset, getObject(arg2).byteLength).set(getArrayU8FromWasm0(arg0, arg1));
}
function __wbindgen_object_drop_ref(arg0) {
  takeObject(arg0);
}

// /projects/Novorender/ts/dist/core3d/modules/octree/worker/wasm_loader.ts
async function esbuildWasmInstance(wasmData) {
  let imports = {
    ["./wasm_parser_bg.js"]: wasm_parser_bg_exports
  };
  const { instance } = await WebAssembly.instantiate(wasmData, imports);
  __wbg_set_wasm(instance.exports);
  return wasm_parser_bg_exports;
}

// /projects/Novorender/ts/dist/core3d/modules/octree/worker/handler.ts
var LoaderHandler = class {
  constructor(send) {
    this.send = send;
  }
  downloader = new Downloader();
  downloads = /* @__PURE__ */ new Map();
  highlights = void 0;
  // will be set right after construction by "buffer" message
  wasm;
  receive(msg) {
    switch (msg.kind) {
      case "init":
        this.init(msg);
        break;
      case "parse":
        this.parse(msg);
        break;
      case "load":
        this.load(msg);
        break;
      case "abort":
        this.abort(msg);
        break;
      case "abort_all":
        this.abortAll(msg);
        break;
    }
  }
  async init(msg) {
    const { wasmData, buffer } = msg;
    this.wasm = await esbuildWasmInstance(wasmData);
    const indices = new Uint8Array(buffer, 4);
    const mutex = new Mutex(buffer);
    this.highlights = { buffer, indices, mutex };
    const setBufferMsg = { kind: "buffer" };
    this.send(setBufferMsg);
  }
  parseBuffer(buffer, params) {
    if (this.wasm) {
      const { highlights } = this;
      const { id, version: version3, separatePositionsBuffer, enableOutlines, applyFilter } = params;
      const { childInfos, geometry } = parseNode(this.wasm, id, separatePositionsBuffer, enableOutlines, version3, buffer, highlights, applyFilter);
      const readyMsg = { kind: "ready", id, childInfos, geometry };
      const transfer = [];
      for (const { vertexBuffers, indices } of geometry.subMeshes) {
        transfer.push(...vertexBuffers);
        if (typeof indices != "number") {
          transfer.push(indices.buffer);
        }
      }
      this.send(readyMsg, transfer);
    } else {
      console.error("Wasm is not initialized yet");
    }
  }
  async parse(params) {
    const { id, buffer } = params;
    try {
      this.parseBuffer(buffer, params);
    } catch (error) {
      this.error(id, error);
    }
  }
  async load(params) {
    const { downloader, downloads } = this;
    const { url, id, byteSize } = params;
    try {
      const download = downloader.downloadArrayBufferAbortable(url, new ArrayBuffer(byteSize));
      downloads.set(id, download);
      const buffer = await download.result;
      downloads.delete(id);
      if (buffer) {
        this.parseBuffer(buffer, params);
      } else {
        const abortedMsg = { kind: "aborted", id };
        this.send(abortedMsg);
      }
    } catch (error) {
      this.error(id, error);
    }
  }
  removeNode(id) {
    const { downloads } = this;
    const download = downloads.get(id);
    downloads.delete(id);
    return { download };
  }
  error(id, error) {
    const { download } = this.removeNode(id);
    const errorMsg = { kind: "error", id, error };
    this.send(errorMsg);
  }
  abort(params) {
    const { id } = params;
    const { download } = this.removeNode(id);
    download?.abort();
  }
  async abortAll(params) {
    const { downloads, downloader } = this;
    for (const download of downloads.values()) {
      download.abort();
    }
    await downloader.complete();
    console.assert(downloads.size == 0);
    const abortedAllMsg = { kind: "aborted_all" };
    this.send(abortedAllMsg);
  }
};

// /projects/Novorender/ts/dist/core3d/modules/octree/worker/index.ts
var handler = new LoaderHandler((msg, transfer) => {
  postMessage(msg, { transfer });
});
onmessage = (e) => {
  const msg = e.data;
  if (msg.kind == "close") {
    close();
  } else {
    handler.receive(msg);
  }
};
//# sourceMappingURL=loaderWorker.js.map
