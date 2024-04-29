var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// /projects/Novorender/ts/node_modules/comlink/dist/esm/comlink.mjs
var proxyMarker = Symbol("Comlink.proxy");
var createEndpoint = Symbol("Comlink.endpoint");
var releaseProxy = Symbol("Comlink.releaseProxy");
var finalizer = Symbol("Comlink.finalizer");
var throwMarker = Symbol("Comlink.thrown");
var isObject = (val) => typeof val === "object" && val !== null || typeof val === "function";
var proxyTransferHandler = {
  canHandle: (val) => isObject(val) && val[proxyMarker],
  serialize(obj) {
    const { port1, port2 } = new MessageChannel();
    expose(obj, port1);
    return [port2, [port2]];
  },
  deserialize(port) {
    port.start();
    return wrap(port);
  }
};
var throwTransferHandler = {
  canHandle: (value) => isObject(value) && throwMarker in value,
  serialize({ value }) {
    let serialized;
    if (value instanceof Error) {
      serialized = {
        isError: true,
        value: {
          message: value.message,
          name: value.name,
          stack: value.stack
        }
      };
    } else {
      serialized = { isError: false, value };
    }
    return [serialized, []];
  },
  deserialize(serialized) {
    if (serialized.isError) {
      throw Object.assign(new Error(serialized.value.message), serialized.value);
    }
    throw serialized.value;
  }
};
var transferHandlers = /* @__PURE__ */ new Map([
  ["proxy", proxyTransferHandler],
  ["throw", throwTransferHandler]
]);
function isAllowedOrigin(allowedOrigins, origin2) {
  for (const allowedOrigin of allowedOrigins) {
    if (origin2 === allowedOrigin || allowedOrigin === "*") {
      return true;
    }
    if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin2)) {
      return true;
    }
  }
  return false;
}
function expose(obj, ep = globalThis, allowedOrigins = ["*"]) {
  ep.addEventListener("message", function callback(ev) {
    if (!ev || !ev.data) {
      return;
    }
    if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
      console.warn(`Invalid origin '${ev.origin}' for comlink proxy`);
      return;
    }
    const { id, type, path } = Object.assign({ path: [] }, ev.data);
    const argumentList = (ev.data.argumentList || []).map(fromWireValue);
    let returnValue;
    try {
      const parent = path.slice(0, -1).reduce((obj2, prop) => obj2[prop], obj);
      const rawValue = path.reduce((obj2, prop) => obj2[prop], obj);
      switch (type) {
        case "GET":
          {
            returnValue = rawValue;
          }
          break;
        case "SET":
          {
            parent[path.slice(-1)[0]] = fromWireValue(ev.data.value);
            returnValue = true;
          }
          break;
        case "APPLY":
          {
            returnValue = rawValue.apply(parent, argumentList);
          }
          break;
        case "CONSTRUCT":
          {
            const value = new rawValue(...argumentList);
            returnValue = proxy(value);
          }
          break;
        case "ENDPOINT":
          {
            const { port1, port2 } = new MessageChannel();
            expose(obj, port2);
            returnValue = transfer(port1, [port1]);
          }
          break;
        case "RELEASE":
          {
            returnValue = void 0;
          }
          break;
        default:
          return;
      }
    } catch (value) {
      returnValue = { value, [throwMarker]: 0 };
    }
    Promise.resolve(returnValue).catch((value) => {
      return { value, [throwMarker]: 0 };
    }).then((returnValue2) => {
      const [wireValue, transferables] = toWireValue(returnValue2);
      ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
      if (type === "RELEASE") {
        ep.removeEventListener("message", callback);
        closeEndPoint(ep);
        if (finalizer in obj && typeof obj[finalizer] === "function") {
          obj[finalizer]();
        }
      }
    }).catch((error) => {
      const [wireValue, transferables] = toWireValue({
        value: new TypeError("Unserializable return value"),
        [throwMarker]: 0
      });
      ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
    });
  });
  if (ep.start) {
    ep.start();
  }
}
function isMessagePort(endpoint) {
  return endpoint.constructor.name === "MessagePort";
}
function closeEndPoint(endpoint) {
  if (isMessagePort(endpoint))
    endpoint.close();
}
function wrap(ep, target) {
  return createProxy(ep, [], target);
}
function throwIfProxyReleased(isReleased) {
  if (isReleased) {
    throw new Error("Proxy has been released and is not useable");
  }
}
function releaseEndpoint(ep) {
  return requestResponseMessage(ep, {
    type: "RELEASE"
  }).then(() => {
    closeEndPoint(ep);
  });
}
var proxyCounter = /* @__PURE__ */ new WeakMap();
var proxyFinalizers = "FinalizationRegistry" in globalThis && new FinalizationRegistry((ep) => {
  const newCount = (proxyCounter.get(ep) || 0) - 1;
  proxyCounter.set(ep, newCount);
  if (newCount === 0) {
    releaseEndpoint(ep);
  }
});
function registerProxy(proxy2, ep) {
  const newCount = (proxyCounter.get(ep) || 0) + 1;
  proxyCounter.set(ep, newCount);
  if (proxyFinalizers) {
    proxyFinalizers.register(proxy2, ep, proxy2);
  }
}
function unregisterProxy(proxy2) {
  if (proxyFinalizers) {
    proxyFinalizers.unregister(proxy2);
  }
}
function createProxy(ep, path = [], target = function() {
}) {
  let isProxyReleased = false;
  const proxy2 = new Proxy(target, {
    get(_target, prop) {
      throwIfProxyReleased(isProxyReleased);
      if (prop === releaseProxy) {
        return () => {
          unregisterProxy(proxy2);
          releaseEndpoint(ep);
          isProxyReleased = true;
        };
      }
      if (prop === "then") {
        if (path.length === 0) {
          return { then: () => proxy2 };
        }
        const r = requestResponseMessage(ep, {
          type: "GET",
          path: path.map((p) => p.toString())
        }).then(fromWireValue);
        return r.then.bind(r);
      }
      return createProxy(ep, [...path, prop]);
    },
    set(_target, prop, rawValue) {
      throwIfProxyReleased(isProxyReleased);
      const [value, transferables] = toWireValue(rawValue);
      return requestResponseMessage(ep, {
        type: "SET",
        path: [...path, prop].map((p) => p.toString()),
        value
      }, transferables).then(fromWireValue);
    },
    apply(_target, _thisArg, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const last = path[path.length - 1];
      if (last === createEndpoint) {
        return requestResponseMessage(ep, {
          type: "ENDPOINT"
        }).then(fromWireValue);
      }
      if (last === "bind") {
        return createProxy(ep, path.slice(0, -1));
      }
      const [argumentList, transferables] = processArguments(rawArgumentList);
      return requestResponseMessage(ep, {
        type: "APPLY",
        path: path.map((p) => p.toString()),
        argumentList
      }, transferables).then(fromWireValue);
    },
    construct(_target, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const [argumentList, transferables] = processArguments(rawArgumentList);
      return requestResponseMessage(ep, {
        type: "CONSTRUCT",
        path: path.map((p) => p.toString()),
        argumentList
      }, transferables).then(fromWireValue);
    }
  });
  registerProxy(proxy2, ep);
  return proxy2;
}
function myFlat(arr) {
  return Array.prototype.concat.apply([], arr);
}
function processArguments(argumentList) {
  const processed = argumentList.map(toWireValue);
  return [processed.map((v) => v[0]), myFlat(processed.map((v) => v[1]))];
}
var transferCache = /* @__PURE__ */ new WeakMap();
function transfer(obj, transfers) {
  transferCache.set(obj, transfers);
  return obj;
}
function proxy(obj) {
  return Object.assign(obj, { [proxyMarker]: true });
}
function toWireValue(value) {
  for (const [name, handler] of transferHandlers) {
    if (handler.canHandle(value)) {
      const [serializedValue, transferables] = handler.serialize(value);
      return [
        {
          type: "HANDLER",
          name,
          value: serializedValue
        },
        transferables
      ];
    }
  }
  return [
    {
      type: "RAW",
      value
    },
    transferCache.get(value) || []
  ];
}
function fromWireValue(value) {
  switch (value.type) {
    case "HANDLER":
      return transferHandlers.get(value.name).deserialize(value.value);
    case "RAW":
      return value.value;
  }
}
function requestResponseMessage(ep, msg, transfers) {
  return new Promise((resolve) => {
    const id = generateUUID();
    ep.addEventListener("message", function l(ev) {
      if (!ev.data || !ev.data.id || ev.data.id !== id) {
        return;
      }
      ep.removeEventListener("message", l);
      resolve(ev.data);
    });
    if (ep.start) {
      ep.start();
    }
    ep.postMessage(Object.assign({ id }, msg), transfers);
  });
}
function generateUUID() {
  return new Array(4).fill(0).map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)).join("-");
}

// /projects/Novorender/ts/node_modules/gl-matrix/esm/common.js
var common_exports = {};
__export(common_exports, {
  ARRAY_TYPE: () => ARRAY_TYPE,
  EPSILON: () => EPSILON,
  RANDOM: () => RANDOM,
  equals: () => equals,
  setMatrixArrayType: () => setMatrixArrayType,
  toRadian: () => toRadian
});
var EPSILON = 1e-6;
var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
var RANDOM = Math.random;
function setMatrixArrayType(type) {
  ARRAY_TYPE = type;
}
var degree = Math.PI / 180;
function toRadian(a) {
  return a * degree;
}
function equals(a, b) {
  return Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}
if (!Math.hypot)
  Math.hypot = function() {
    var y = 0, i = arguments.length;
    while (i--) {
      y += arguments[i] * arguments[i];
    }
    return Math.sqrt(y);
  };

// /projects/Novorender/ts/node_modules/gl-matrix/esm/mat3.js
var mat3_exports = {};
__export(mat3_exports, {
  add: () => add,
  adjoint: () => adjoint,
  clone: () => clone,
  copy: () => copy,
  create: () => create,
  determinant: () => determinant,
  equals: () => equals2,
  exactEquals: () => exactEquals,
  frob: () => frob,
  fromMat2d: () => fromMat2d,
  fromMat4: () => fromMat4,
  fromQuat: () => fromQuat,
  fromRotation: () => fromRotation,
  fromScaling: () => fromScaling,
  fromTranslation: () => fromTranslation,
  fromValues: () => fromValues,
  identity: () => identity,
  invert: () => invert,
  mul: () => mul,
  multiply: () => multiply,
  multiplyScalar: () => multiplyScalar,
  multiplyScalarAndAdd: () => multiplyScalarAndAdd,
  normalFromMat4: () => normalFromMat4,
  projection: () => projection,
  rotate: () => rotate,
  scale: () => scale,
  set: () => set,
  str: () => str,
  sub: () => sub,
  subtract: () => subtract,
  translate: () => translate,
  transpose: () => transpose
});
function create() {
  var out = new ARRAY_TYPE(9);
  if (ARRAY_TYPE != Float32Array) {
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
  }
  out[0] = 1;
  out[4] = 1;
  out[8] = 1;
  return out;
}
function fromMat4(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[4];
  out[4] = a[5];
  out[5] = a[6];
  out[6] = a[8];
  out[7] = a[9];
  out[8] = a[10];
  return out;
}
function clone(a) {
  var out = new ARRAY_TYPE(9);
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  out[4] = a[4];
  out[5] = a[5];
  out[6] = a[6];
  out[7] = a[7];
  out[8] = a[8];
  return out;
}
function copy(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  out[4] = a[4];
  out[5] = a[5];
  out[6] = a[6];
  out[7] = a[7];
  out[8] = a[8];
  return out;
}
function fromValues(m00, m01, m02, m10, m11, m12, m20, m21, m22) {
  var out = new ARRAY_TYPE(9);
  out[0] = m00;
  out[1] = m01;
  out[2] = m02;
  out[3] = m10;
  out[4] = m11;
  out[5] = m12;
  out[6] = m20;
  out[7] = m21;
  out[8] = m22;
  return out;
}
function set(out, m00, m01, m02, m10, m11, m12, m20, m21, m22) {
  out[0] = m00;
  out[1] = m01;
  out[2] = m02;
  out[3] = m10;
  out[4] = m11;
  out[5] = m12;
  out[6] = m20;
  out[7] = m21;
  out[8] = m22;
  return out;
}
function identity(out) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 1;
  out[5] = 0;
  out[6] = 0;
  out[7] = 0;
  out[8] = 1;
  return out;
}
function transpose(out, a) {
  if (out === a) {
    var a01 = a[1], a02 = a[2], a12 = a[5];
    out[1] = a[3];
    out[2] = a[6];
    out[3] = a01;
    out[5] = a[7];
    out[6] = a02;
    out[7] = a12;
  } else {
    out[0] = a[0];
    out[1] = a[3];
    out[2] = a[6];
    out[3] = a[1];
    out[4] = a[4];
    out[5] = a[7];
    out[6] = a[2];
    out[7] = a[5];
    out[8] = a[8];
  }
  return out;
}
function invert(out, a) {
  var a00 = a[0], a01 = a[1], a02 = a[2];
  var a10 = a[3], a11 = a[4], a12 = a[5];
  var a20 = a[6], a21 = a[7], a22 = a[8];
  var b01 = a22 * a11 - a12 * a21;
  var b11 = -a22 * a10 + a12 * a20;
  var b21 = a21 * a10 - a11 * a20;
  var det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) {
    return null;
  }
  det = 1 / det;
  out[0] = b01 * det;
  out[1] = (-a22 * a01 + a02 * a21) * det;
  out[2] = (a12 * a01 - a02 * a11) * det;
  out[3] = b11 * det;
  out[4] = (a22 * a00 - a02 * a20) * det;
  out[5] = (-a12 * a00 + a02 * a10) * det;
  out[6] = b21 * det;
  out[7] = (-a21 * a00 + a01 * a20) * det;
  out[8] = (a11 * a00 - a01 * a10) * det;
  return out;
}
function adjoint(out, a) {
  var a00 = a[0], a01 = a[1], a02 = a[2];
  var a10 = a[3], a11 = a[4], a12 = a[5];
  var a20 = a[6], a21 = a[7], a22 = a[8];
  out[0] = a11 * a22 - a12 * a21;
  out[1] = a02 * a21 - a01 * a22;
  out[2] = a01 * a12 - a02 * a11;
  out[3] = a12 * a20 - a10 * a22;
  out[4] = a00 * a22 - a02 * a20;
  out[5] = a02 * a10 - a00 * a12;
  out[6] = a10 * a21 - a11 * a20;
  out[7] = a01 * a20 - a00 * a21;
  out[8] = a00 * a11 - a01 * a10;
  return out;
}
function determinant(a) {
  var a00 = a[0], a01 = a[1], a02 = a[2];
  var a10 = a[3], a11 = a[4], a12 = a[5];
  var a20 = a[6], a21 = a[7], a22 = a[8];
  return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
}
function multiply(out, a, b) {
  var a00 = a[0], a01 = a[1], a02 = a[2];
  var a10 = a[3], a11 = a[4], a12 = a[5];
  var a20 = a[6], a21 = a[7], a22 = a[8];
  var b00 = b[0], b01 = b[1], b02 = b[2];
  var b10 = b[3], b11 = b[4], b12 = b[5];
  var b20 = b[6], b21 = b[7], b22 = b[8];
  out[0] = b00 * a00 + b01 * a10 + b02 * a20;
  out[1] = b00 * a01 + b01 * a11 + b02 * a21;
  out[2] = b00 * a02 + b01 * a12 + b02 * a22;
  out[3] = b10 * a00 + b11 * a10 + b12 * a20;
  out[4] = b10 * a01 + b11 * a11 + b12 * a21;
  out[5] = b10 * a02 + b11 * a12 + b12 * a22;
  out[6] = b20 * a00 + b21 * a10 + b22 * a20;
  out[7] = b20 * a01 + b21 * a11 + b22 * a21;
  out[8] = b20 * a02 + b21 * a12 + b22 * a22;
  return out;
}
function translate(out, a, v) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8], x = v[0], y = v[1];
  out[0] = a00;
  out[1] = a01;
  out[2] = a02;
  out[3] = a10;
  out[4] = a11;
  out[5] = a12;
  out[6] = x * a00 + y * a10 + a20;
  out[7] = x * a01 + y * a11 + a21;
  out[8] = x * a02 + y * a12 + a22;
  return out;
}
function rotate(out, a, rad) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8], s = Math.sin(rad), c = Math.cos(rad);
  out[0] = c * a00 + s * a10;
  out[1] = c * a01 + s * a11;
  out[2] = c * a02 + s * a12;
  out[3] = c * a10 - s * a00;
  out[4] = c * a11 - s * a01;
  out[5] = c * a12 - s * a02;
  out[6] = a20;
  out[7] = a21;
  out[8] = a22;
  return out;
}
function scale(out, a, v) {
  var x = v[0], y = v[1];
  out[0] = x * a[0];
  out[1] = x * a[1];
  out[2] = x * a[2];
  out[3] = y * a[3];
  out[4] = y * a[4];
  out[5] = y * a[5];
  out[6] = a[6];
  out[7] = a[7];
  out[8] = a[8];
  return out;
}
function fromTranslation(out, v) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 1;
  out[5] = 0;
  out[6] = v[0];
  out[7] = v[1];
  out[8] = 1;
  return out;
}
function fromRotation(out, rad) {
  var s = Math.sin(rad), c = Math.cos(rad);
  out[0] = c;
  out[1] = s;
  out[2] = 0;
  out[3] = -s;
  out[4] = c;
  out[5] = 0;
  out[6] = 0;
  out[7] = 0;
  out[8] = 1;
  return out;
}
function fromScaling(out, v) {
  out[0] = v[0];
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = v[1];
  out[5] = 0;
  out[6] = 0;
  out[7] = 0;
  out[8] = 1;
  return out;
}
function fromMat2d(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = 0;
  out[3] = a[2];
  out[4] = a[3];
  out[5] = 0;
  out[6] = a[4];
  out[7] = a[5];
  out[8] = 1;
  return out;
}
function fromQuat(out, q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  var x2 = x + x;
  var y2 = y + y;
  var z2 = z + z;
  var xx = x * x2;
  var yx = y * x2;
  var yy = y * y2;
  var zx = z * x2;
  var zy = z * y2;
  var zz = z * z2;
  var wx = w * x2;
  var wy = w * y2;
  var wz = w * z2;
  out[0] = 1 - yy - zz;
  out[3] = yx - wz;
  out[6] = zx + wy;
  out[1] = yx + wz;
  out[4] = 1 - xx - zz;
  out[7] = zy - wx;
  out[2] = zx - wy;
  out[5] = zy + wx;
  out[8] = 1 - xx - yy;
  return out;
}
function normalFromMat4(out, a) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b00 = a00 * a11 - a01 * a10;
  var b01 = a00 * a12 - a02 * a10;
  var b02 = a00 * a13 - a03 * a10;
  var b03 = a01 * a12 - a02 * a11;
  var b04 = a01 * a13 - a03 * a11;
  var b05 = a02 * a13 - a03 * a12;
  var b06 = a20 * a31 - a21 * a30;
  var b07 = a20 * a32 - a22 * a30;
  var b08 = a20 * a33 - a23 * a30;
  var b09 = a21 * a32 - a22 * a31;
  var b10 = a21 * a33 - a23 * a31;
  var b11 = a22 * a33 - a23 * a32;
  var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) {
    return null;
  }
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[2] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[3] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[4] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[5] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[6] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[7] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[8] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  return out;
}
function projection(out, width, height) {
  out[0] = 2 / width;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = -2 / height;
  out[5] = 0;
  out[6] = -1;
  out[7] = 1;
  out[8] = 1;
  return out;
}
function str(a) {
  return "mat3(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ", " + a[8] + ")";
}
function frob(a) {
  return Math.hypot(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]);
}
function add(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  out[3] = a[3] + b[3];
  out[4] = a[4] + b[4];
  out[5] = a[5] + b[5];
  out[6] = a[6] + b[6];
  out[7] = a[7] + b[7];
  out[8] = a[8] + b[8];
  return out;
}
function subtract(out, a, b) {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  out[3] = a[3] - b[3];
  out[4] = a[4] - b[4];
  out[5] = a[5] - b[5];
  out[6] = a[6] - b[6];
  out[7] = a[7] - b[7];
  out[8] = a[8] - b[8];
  return out;
}
function multiplyScalar(out, a, b) {
  out[0] = a[0] * b;
  out[1] = a[1] * b;
  out[2] = a[2] * b;
  out[3] = a[3] * b;
  out[4] = a[4] * b;
  out[5] = a[5] * b;
  out[6] = a[6] * b;
  out[7] = a[7] * b;
  out[8] = a[8] * b;
  return out;
}
function multiplyScalarAndAdd(out, a, b, scale6) {
  out[0] = a[0] + b[0] * scale6;
  out[1] = a[1] + b[1] * scale6;
  out[2] = a[2] + b[2] * scale6;
  out[3] = a[3] + b[3] * scale6;
  out[4] = a[4] + b[4] * scale6;
  out[5] = a[5] + b[5] * scale6;
  out[6] = a[6] + b[6] * scale6;
  out[7] = a[7] + b[7] * scale6;
  out[8] = a[8] + b[8] * scale6;
  return out;
}
function exactEquals(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8];
}
function equals2(a, b) {
  var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
  var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8];
  return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7)) && Math.abs(a8 - b8) <= EPSILON * Math.max(1, Math.abs(a8), Math.abs(b8));
}
var mul = multiply;
var sub = subtract;

// /projects/Novorender/ts/node_modules/gl-matrix/esm/mat4.js
var mat4_exports = {};
__export(mat4_exports, {
  add: () => add2,
  adjoint: () => adjoint2,
  clone: () => clone2,
  copy: () => copy2,
  create: () => create2,
  determinant: () => determinant2,
  equals: () => equals3,
  exactEquals: () => exactEquals2,
  frob: () => frob2,
  fromQuat: () => fromQuat3,
  fromQuat2: () => fromQuat2,
  fromRotation: () => fromRotation2,
  fromRotationTranslation: () => fromRotationTranslation,
  fromRotationTranslationScale: () => fromRotationTranslationScale,
  fromRotationTranslationScaleOrigin: () => fromRotationTranslationScaleOrigin,
  fromScaling: () => fromScaling2,
  fromTranslation: () => fromTranslation2,
  fromValues: () => fromValues2,
  fromXRotation: () => fromXRotation,
  fromYRotation: () => fromYRotation,
  fromZRotation: () => fromZRotation,
  frustum: () => frustum,
  getRotation: () => getRotation,
  getScaling: () => getScaling,
  getTranslation: () => getTranslation,
  identity: () => identity2,
  invert: () => invert2,
  lookAt: () => lookAt,
  mul: () => mul2,
  multiply: () => multiply2,
  multiplyScalar: () => multiplyScalar2,
  multiplyScalarAndAdd: () => multiplyScalarAndAdd2,
  ortho: () => ortho,
  orthoNO: () => orthoNO,
  orthoZO: () => orthoZO,
  perspective: () => perspective,
  perspectiveFromFieldOfView: () => perspectiveFromFieldOfView,
  perspectiveNO: () => perspectiveNO,
  perspectiveZO: () => perspectiveZO,
  rotate: () => rotate2,
  rotateX: () => rotateX,
  rotateY: () => rotateY,
  rotateZ: () => rotateZ,
  scale: () => scale2,
  set: () => set2,
  str: () => str2,
  sub: () => sub2,
  subtract: () => subtract2,
  targetTo: () => targetTo,
  translate: () => translate2,
  transpose: () => transpose2
});
function create2() {
  var out = new ARRAY_TYPE(16);
  if (ARRAY_TYPE != Float32Array) {
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
  }
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}
function clone2(a) {
  var out = new ARRAY_TYPE(16);
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  out[4] = a[4];
  out[5] = a[5];
  out[6] = a[6];
  out[7] = a[7];
  out[8] = a[8];
  out[9] = a[9];
  out[10] = a[10];
  out[11] = a[11];
  out[12] = a[12];
  out[13] = a[13];
  out[14] = a[14];
  out[15] = a[15];
  return out;
}
function copy2(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  out[4] = a[4];
  out[5] = a[5];
  out[6] = a[6];
  out[7] = a[7];
  out[8] = a[8];
  out[9] = a[9];
  out[10] = a[10];
  out[11] = a[11];
  out[12] = a[12];
  out[13] = a[13];
  out[14] = a[14];
  out[15] = a[15];
  return out;
}
function fromValues2(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
  var out = new ARRAY_TYPE(16);
  out[0] = m00;
  out[1] = m01;
  out[2] = m02;
  out[3] = m03;
  out[4] = m10;
  out[5] = m11;
  out[6] = m12;
  out[7] = m13;
  out[8] = m20;
  out[9] = m21;
  out[10] = m22;
  out[11] = m23;
  out[12] = m30;
  out[13] = m31;
  out[14] = m32;
  out[15] = m33;
  return out;
}
function set2(out, m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
  out[0] = m00;
  out[1] = m01;
  out[2] = m02;
  out[3] = m03;
  out[4] = m10;
  out[5] = m11;
  out[6] = m12;
  out[7] = m13;
  out[8] = m20;
  out[9] = m21;
  out[10] = m22;
  out[11] = m23;
  out[12] = m30;
  out[13] = m31;
  out[14] = m32;
  out[15] = m33;
  return out;
}
function identity2(out) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = 1;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}
function transpose2(out, a) {
  if (out === a) {
    var a01 = a[1], a02 = a[2], a03 = a[3];
    var a12 = a[6], a13 = a[7];
    var a23 = a[11];
    out[1] = a[4];
    out[2] = a[8];
    out[3] = a[12];
    out[4] = a01;
    out[6] = a[9];
    out[7] = a[13];
    out[8] = a02;
    out[9] = a12;
    out[11] = a[14];
    out[12] = a03;
    out[13] = a13;
    out[14] = a23;
  } else {
    out[0] = a[0];
    out[1] = a[4];
    out[2] = a[8];
    out[3] = a[12];
    out[4] = a[1];
    out[5] = a[5];
    out[6] = a[9];
    out[7] = a[13];
    out[8] = a[2];
    out[9] = a[6];
    out[10] = a[10];
    out[11] = a[14];
    out[12] = a[3];
    out[13] = a[7];
    out[14] = a[11];
    out[15] = a[15];
  }
  return out;
}
function invert2(out, a) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b00 = a00 * a11 - a01 * a10;
  var b01 = a00 * a12 - a02 * a10;
  var b02 = a00 * a13 - a03 * a10;
  var b03 = a01 * a12 - a02 * a11;
  var b04 = a01 * a13 - a03 * a11;
  var b05 = a02 * a13 - a03 * a12;
  var b06 = a20 * a31 - a21 * a30;
  var b07 = a20 * a32 - a22 * a30;
  var b08 = a20 * a33 - a23 * a30;
  var b09 = a21 * a32 - a22 * a31;
  var b10 = a21 * a33 - a23 * a31;
  var b11 = a22 * a33 - a23 * a32;
  var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) {
    return null;
  }
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}
function adjoint2(out, a) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  out[0] = a11 * (a22 * a33 - a23 * a32) - a21 * (a12 * a33 - a13 * a32) + a31 * (a12 * a23 - a13 * a22);
  out[1] = -(a01 * (a22 * a33 - a23 * a32) - a21 * (a02 * a33 - a03 * a32) + a31 * (a02 * a23 - a03 * a22));
  out[2] = a01 * (a12 * a33 - a13 * a32) - a11 * (a02 * a33 - a03 * a32) + a31 * (a02 * a13 - a03 * a12);
  out[3] = -(a01 * (a12 * a23 - a13 * a22) - a11 * (a02 * a23 - a03 * a22) + a21 * (a02 * a13 - a03 * a12));
  out[4] = -(a10 * (a22 * a33 - a23 * a32) - a20 * (a12 * a33 - a13 * a32) + a30 * (a12 * a23 - a13 * a22));
  out[5] = a00 * (a22 * a33 - a23 * a32) - a20 * (a02 * a33 - a03 * a32) + a30 * (a02 * a23 - a03 * a22);
  out[6] = -(a00 * (a12 * a33 - a13 * a32) - a10 * (a02 * a33 - a03 * a32) + a30 * (a02 * a13 - a03 * a12));
  out[7] = a00 * (a12 * a23 - a13 * a22) - a10 * (a02 * a23 - a03 * a22) + a20 * (a02 * a13 - a03 * a12);
  out[8] = a10 * (a21 * a33 - a23 * a31) - a20 * (a11 * a33 - a13 * a31) + a30 * (a11 * a23 - a13 * a21);
  out[9] = -(a00 * (a21 * a33 - a23 * a31) - a20 * (a01 * a33 - a03 * a31) + a30 * (a01 * a23 - a03 * a21));
  out[10] = a00 * (a11 * a33 - a13 * a31) - a10 * (a01 * a33 - a03 * a31) + a30 * (a01 * a13 - a03 * a11);
  out[11] = -(a00 * (a11 * a23 - a13 * a21) - a10 * (a01 * a23 - a03 * a21) + a20 * (a01 * a13 - a03 * a11));
  out[12] = -(a10 * (a21 * a32 - a22 * a31) - a20 * (a11 * a32 - a12 * a31) + a30 * (a11 * a22 - a12 * a21));
  out[13] = a00 * (a21 * a32 - a22 * a31) - a20 * (a01 * a32 - a02 * a31) + a30 * (a01 * a22 - a02 * a21);
  out[14] = -(a00 * (a11 * a32 - a12 * a31) - a10 * (a01 * a32 - a02 * a31) + a30 * (a01 * a12 - a02 * a11));
  out[15] = a00 * (a11 * a22 - a12 * a21) - a10 * (a01 * a22 - a02 * a21) + a20 * (a01 * a12 - a02 * a11);
  return out;
}
function determinant2(a) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b00 = a00 * a11 - a01 * a10;
  var b01 = a00 * a12 - a02 * a10;
  var b02 = a00 * a13 - a03 * a10;
  var b03 = a01 * a12 - a02 * a11;
  var b04 = a01 * a13 - a03 * a11;
  var b05 = a02 * a13 - a03 * a12;
  var b06 = a20 * a31 - a21 * a30;
  var b07 = a20 * a32 - a22 * a30;
  var b08 = a20 * a33 - a23 * a30;
  var b09 = a21 * a32 - a22 * a31;
  var b10 = a21 * a33 - a23 * a31;
  var b11 = a22 * a33 - a23 * a32;
  return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
}
function multiply2(out, a, b) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[4];
  b1 = b[5];
  b2 = b[6];
  b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[8];
  b1 = b[9];
  b2 = b[10];
  b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[12];
  b1 = b[13];
  b2 = b[14];
  b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}
function translate2(out, a, v) {
  var x = v[0], y = v[1], z = v[2];
  var a00, a01, a02, a03;
  var a10, a11, a12, a13;
  var a20, a21, a22, a23;
  if (a === out) {
    out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
    out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
    out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
    out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
  } else {
    a00 = a[0];
    a01 = a[1];
    a02 = a[2];
    a03 = a[3];
    a10 = a[4];
    a11 = a[5];
    a12 = a[6];
    a13 = a[7];
    a20 = a[8];
    a21 = a[9];
    a22 = a[10];
    a23 = a[11];
    out[0] = a00;
    out[1] = a01;
    out[2] = a02;
    out[3] = a03;
    out[4] = a10;
    out[5] = a11;
    out[6] = a12;
    out[7] = a13;
    out[8] = a20;
    out[9] = a21;
    out[10] = a22;
    out[11] = a23;
    out[12] = a00 * x + a10 * y + a20 * z + a[12];
    out[13] = a01 * x + a11 * y + a21 * z + a[13];
    out[14] = a02 * x + a12 * y + a22 * z + a[14];
    out[15] = a03 * x + a13 * y + a23 * z + a[15];
  }
  return out;
}
function scale2(out, a, v) {
  var x = v[0], y = v[1], z = v[2];
  out[0] = a[0] * x;
  out[1] = a[1] * x;
  out[2] = a[2] * x;
  out[3] = a[3] * x;
  out[4] = a[4] * y;
  out[5] = a[5] * y;
  out[6] = a[6] * y;
  out[7] = a[7] * y;
  out[8] = a[8] * z;
  out[9] = a[9] * z;
  out[10] = a[10] * z;
  out[11] = a[11] * z;
  out[12] = a[12];
  out[13] = a[13];
  out[14] = a[14];
  out[15] = a[15];
  return out;
}
function rotate2(out, a, rad, axis) {
  var x = axis[0], y = axis[1], z = axis[2];
  var len4 = Math.hypot(x, y, z);
  var s, c, t;
  var a00, a01, a02, a03;
  var a10, a11, a12, a13;
  var a20, a21, a22, a23;
  var b00, b01, b02;
  var b10, b11, b12;
  var b20, b21, b22;
  if (len4 < EPSILON) {
    return null;
  }
  len4 = 1 / len4;
  x *= len4;
  y *= len4;
  z *= len4;
  s = Math.sin(rad);
  c = Math.cos(rad);
  t = 1 - c;
  a00 = a[0];
  a01 = a[1];
  a02 = a[2];
  a03 = a[3];
  a10 = a[4];
  a11 = a[5];
  a12 = a[6];
  a13 = a[7];
  a20 = a[8];
  a21 = a[9];
  a22 = a[10];
  a23 = a[11];
  b00 = x * x * t + c;
  b01 = y * x * t + z * s;
  b02 = z * x * t - y * s;
  b10 = x * y * t - z * s;
  b11 = y * y * t + c;
  b12 = z * y * t + x * s;
  b20 = x * z * t + y * s;
  b21 = y * z * t - x * s;
  b22 = z * z * t + c;
  out[0] = a00 * b00 + a10 * b01 + a20 * b02;
  out[1] = a01 * b00 + a11 * b01 + a21 * b02;
  out[2] = a02 * b00 + a12 * b01 + a22 * b02;
  out[3] = a03 * b00 + a13 * b01 + a23 * b02;
  out[4] = a00 * b10 + a10 * b11 + a20 * b12;
  out[5] = a01 * b10 + a11 * b11 + a21 * b12;
  out[6] = a02 * b10 + a12 * b11 + a22 * b12;
  out[7] = a03 * b10 + a13 * b11 + a23 * b12;
  out[8] = a00 * b20 + a10 * b21 + a20 * b22;
  out[9] = a01 * b20 + a11 * b21 + a21 * b22;
  out[10] = a02 * b20 + a12 * b21 + a22 * b22;
  out[11] = a03 * b20 + a13 * b21 + a23 * b22;
  if (a !== out) {
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
  }
  return out;
}
function rotateX(out, a, rad) {
  var s = Math.sin(rad);
  var c = Math.cos(rad);
  var a10 = a[4];
  var a11 = a[5];
  var a12 = a[6];
  var a13 = a[7];
  var a20 = a[8];
  var a21 = a[9];
  var a22 = a[10];
  var a23 = a[11];
  if (a !== out) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
  }
  out[4] = a10 * c + a20 * s;
  out[5] = a11 * c + a21 * s;
  out[6] = a12 * c + a22 * s;
  out[7] = a13 * c + a23 * s;
  out[8] = a20 * c - a10 * s;
  out[9] = a21 * c - a11 * s;
  out[10] = a22 * c - a12 * s;
  out[11] = a23 * c - a13 * s;
  return out;
}
function rotateY(out, a, rad) {
  var s = Math.sin(rad);
  var c = Math.cos(rad);
  var a00 = a[0];
  var a01 = a[1];
  var a02 = a[2];
  var a03 = a[3];
  var a20 = a[8];
  var a21 = a[9];
  var a22 = a[10];
  var a23 = a[11];
  if (a !== out) {
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
  }
  out[0] = a00 * c - a20 * s;
  out[1] = a01 * c - a21 * s;
  out[2] = a02 * c - a22 * s;
  out[3] = a03 * c - a23 * s;
  out[8] = a00 * s + a20 * c;
  out[9] = a01 * s + a21 * c;
  out[10] = a02 * s + a22 * c;
  out[11] = a03 * s + a23 * c;
  return out;
}
function rotateZ(out, a, rad) {
  var s = Math.sin(rad);
  var c = Math.cos(rad);
  var a00 = a[0];
  var a01 = a[1];
  var a02 = a[2];
  var a03 = a[3];
  var a10 = a[4];
  var a11 = a[5];
  var a12 = a[6];
  var a13 = a[7];
  if (a !== out) {
    out[8] = a[8];
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
  }
  out[0] = a00 * c + a10 * s;
  out[1] = a01 * c + a11 * s;
  out[2] = a02 * c + a12 * s;
  out[3] = a03 * c + a13 * s;
  out[4] = a10 * c - a00 * s;
  out[5] = a11 * c - a01 * s;
  out[6] = a12 * c - a02 * s;
  out[7] = a13 * c - a03 * s;
  return out;
}
function fromTranslation2(out, v) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = 1;
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out;
}
function fromScaling2(out, v) {
  out[0] = v[0];
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = v[1];
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = v[2];
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}
function fromRotation2(out, rad, axis) {
  var x = axis[0], y = axis[1], z = axis[2];
  var len4 = Math.hypot(x, y, z);
  var s, c, t;
  if (len4 < EPSILON) {
    return null;
  }
  len4 = 1 / len4;
  x *= len4;
  y *= len4;
  z *= len4;
  s = Math.sin(rad);
  c = Math.cos(rad);
  t = 1 - c;
  out[0] = x * x * t + c;
  out[1] = y * x * t + z * s;
  out[2] = z * x * t - y * s;
  out[3] = 0;
  out[4] = x * y * t - z * s;
  out[5] = y * y * t + c;
  out[6] = z * y * t + x * s;
  out[7] = 0;
  out[8] = x * z * t + y * s;
  out[9] = y * z * t - x * s;
  out[10] = z * z * t + c;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}
function fromXRotation(out, rad) {
  var s = Math.sin(rad);
  var c = Math.cos(rad);
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = c;
  out[6] = s;
  out[7] = 0;
  out[8] = 0;
  out[9] = -s;
  out[10] = c;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}
function fromYRotation(out, rad) {
  var s = Math.sin(rad);
  var c = Math.cos(rad);
  out[0] = c;
  out[1] = 0;
  out[2] = -s;
  out[3] = 0;
  out[4] = 0;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  out[8] = s;
  out[9] = 0;
  out[10] = c;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}
function fromZRotation(out, rad) {
  var s = Math.sin(rad);
  var c = Math.cos(rad);
  out[0] = c;
  out[1] = s;
  out[2] = 0;
  out[3] = 0;
  out[4] = -s;
  out[5] = c;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = 1;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}
function fromRotationTranslation(out, q, v) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  var x2 = x + x;
  var y2 = y + y;
  var z2 = z + z;
  var xx = x * x2;
  var xy = x * y2;
  var xz = x * z2;
  var yy = y * y2;
  var yz = y * z2;
  var zz = z * z2;
  var wx = w * x2;
  var wy = w * y2;
  var wz = w * z2;
  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;
  out[3] = 0;
  out[4] = xy - wz;
  out[5] = 1 - (xx + zz);
  out[6] = yz + wx;
  out[7] = 0;
  out[8] = xz + wy;
  out[9] = yz - wx;
  out[10] = 1 - (xx + yy);
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out;
}
function fromQuat2(out, a) {
  var translation = new ARRAY_TYPE(3);
  var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7];
  var magnitude = bx * bx + by * by + bz * bz + bw * bw;
  if (magnitude > 0) {
    translation[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2 / magnitude;
    translation[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2 / magnitude;
    translation[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2 / magnitude;
  } else {
    translation[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2;
    translation[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2;
    translation[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2;
  }
  fromRotationTranslation(out, a, translation);
  return out;
}
function getTranslation(out, mat) {
  out[0] = mat[12];
  out[1] = mat[13];
  out[2] = mat[14];
  return out;
}
function getScaling(out, mat) {
  var m11 = mat[0];
  var m12 = mat[1];
  var m13 = mat[2];
  var m21 = mat[4];
  var m22 = mat[5];
  var m23 = mat[6];
  var m31 = mat[8];
  var m32 = mat[9];
  var m33 = mat[10];
  out[0] = Math.hypot(m11, m12, m13);
  out[1] = Math.hypot(m21, m22, m23);
  out[2] = Math.hypot(m31, m32, m33);
  return out;
}
function getRotation(out, mat) {
  var scaling = new ARRAY_TYPE(3);
  getScaling(scaling, mat);
  var is1 = 1 / scaling[0];
  var is2 = 1 / scaling[1];
  var is3 = 1 / scaling[2];
  var sm11 = mat[0] * is1;
  var sm12 = mat[1] * is2;
  var sm13 = mat[2] * is3;
  var sm21 = mat[4] * is1;
  var sm22 = mat[5] * is2;
  var sm23 = mat[6] * is3;
  var sm31 = mat[8] * is1;
  var sm32 = mat[9] * is2;
  var sm33 = mat[10] * is3;
  var trace = sm11 + sm22 + sm33;
  var S = 0;
  if (trace > 0) {
    S = Math.sqrt(trace + 1) * 2;
    out[3] = 0.25 * S;
    out[0] = (sm23 - sm32) / S;
    out[1] = (sm31 - sm13) / S;
    out[2] = (sm12 - sm21) / S;
  } else if (sm11 > sm22 && sm11 > sm33) {
    S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
    out[3] = (sm23 - sm32) / S;
    out[0] = 0.25 * S;
    out[1] = (sm12 + sm21) / S;
    out[2] = (sm31 + sm13) / S;
  } else if (sm22 > sm33) {
    S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
    out[3] = (sm31 - sm13) / S;
    out[0] = (sm12 + sm21) / S;
    out[1] = 0.25 * S;
    out[2] = (sm23 + sm32) / S;
  } else {
    S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
    out[3] = (sm12 - sm21) / S;
    out[0] = (sm31 + sm13) / S;
    out[1] = (sm23 + sm32) / S;
    out[2] = 0.25 * S;
  }
  return out;
}
function fromRotationTranslationScale(out, q, v, s) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  var x2 = x + x;
  var y2 = y + y;
  var z2 = z + z;
  var xx = x * x2;
  var xy = x * y2;
  var xz = x * z2;
  var yy = y * y2;
  var yz = y * z2;
  var zz = z * z2;
  var wx = w * x2;
  var wy = w * y2;
  var wz = w * z2;
  var sx = s[0];
  var sy = s[1];
  var sz = s[2];
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out;
}
function fromRotationTranslationScaleOrigin(out, q, v, s, o) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  var x2 = x + x;
  var y2 = y + y;
  var z2 = z + z;
  var xx = x * x2;
  var xy = x * y2;
  var xz = x * z2;
  var yy = y * y2;
  var yz = y * z2;
  var zz = z * z2;
  var wx = w * x2;
  var wy = w * y2;
  var wz = w * z2;
  var sx = s[0];
  var sy = s[1];
  var sz = s[2];
  var ox = o[0];
  var oy = o[1];
  var oz = o[2];
  var out0 = (1 - (yy + zz)) * sx;
  var out1 = (xy + wz) * sx;
  var out2 = (xz - wy) * sx;
  var out4 = (xy - wz) * sy;
  var out5 = (1 - (xx + zz)) * sy;
  var out6 = (yz + wx) * sy;
  var out8 = (xz + wy) * sz;
  var out9 = (yz - wx) * sz;
  var out10 = (1 - (xx + yy)) * sz;
  out[0] = out0;
  out[1] = out1;
  out[2] = out2;
  out[3] = 0;
  out[4] = out4;
  out[5] = out5;
  out[6] = out6;
  out[7] = 0;
  out[8] = out8;
  out[9] = out9;
  out[10] = out10;
  out[11] = 0;
  out[12] = v[0] + ox - (out0 * ox + out4 * oy + out8 * oz);
  out[13] = v[1] + oy - (out1 * ox + out5 * oy + out9 * oz);
  out[14] = v[2] + oz - (out2 * ox + out6 * oy + out10 * oz);
  out[15] = 1;
  return out;
}
function fromQuat3(out, q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  var x2 = x + x;
  var y2 = y + y;
  var z2 = z + z;
  var xx = x * x2;
  var yx = y * x2;
  var yy = y * y2;
  var zx = z * x2;
  var zy = z * y2;
  var zz = z * z2;
  var wx = w * x2;
  var wy = w * y2;
  var wz = w * z2;
  out[0] = 1 - yy - zz;
  out[1] = yx + wz;
  out[2] = zx - wy;
  out[3] = 0;
  out[4] = yx - wz;
  out[5] = 1 - xx - zz;
  out[6] = zy + wx;
  out[7] = 0;
  out[8] = zx + wy;
  out[9] = zy - wx;
  out[10] = 1 - xx - yy;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}
function frustum(out, left, right, bottom, top, near, far) {
  var rl = 1 / (right - left);
  var tb = 1 / (top - bottom);
  var nf = 1 / (near - far);
  out[0] = near * 2 * rl;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = near * 2 * tb;
  out[6] = 0;
  out[7] = 0;
  out[8] = (right + left) * rl;
  out[9] = (top + bottom) * tb;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = far * near * 2 * nf;
  out[15] = 0;
  return out;
}
function perspectiveNO(out, fovy, aspect, near, far) {
  var f = 1 / Math.tan(fovy / 2), nf;
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[15] = 0;
  if (far != null && far !== Infinity) {
    nf = 1 / (near - far);
    out[10] = (far + near) * nf;
    out[14] = 2 * far * near * nf;
  } else {
    out[10] = -1;
    out[14] = -2 * near;
  }
  return out;
}
var perspective = perspectiveNO;
function perspectiveZO(out, fovy, aspect, near, far) {
  var f = 1 / Math.tan(fovy / 2), nf;
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[15] = 0;
  if (far != null && far !== Infinity) {
    nf = 1 / (near - far);
    out[10] = far * nf;
    out[14] = far * near * nf;
  } else {
    out[10] = -1;
    out[14] = -near;
  }
  return out;
}
function perspectiveFromFieldOfView(out, fov, near, far) {
  var upTan = Math.tan(fov.upDegrees * Math.PI / 180);
  var downTan = Math.tan(fov.downDegrees * Math.PI / 180);
  var leftTan = Math.tan(fov.leftDegrees * Math.PI / 180);
  var rightTan = Math.tan(fov.rightDegrees * Math.PI / 180);
  var xScale = 2 / (leftTan + rightTan);
  var yScale = 2 / (upTan + downTan);
  out[0] = xScale;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = yScale;
  out[6] = 0;
  out[7] = 0;
  out[8] = -((leftTan - rightTan) * xScale * 0.5);
  out[9] = (upTan - downTan) * yScale * 0.5;
  out[10] = far / (near - far);
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = far * near / (near - far);
  out[15] = 0;
  return out;
}
function orthoNO(out, left, right, bottom, top, near, far) {
  var lr = 1 / (left - right);
  var bt = 1 / (bottom - top);
  var nf = 1 / (near - far);
  out[0] = -2 * lr;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = -2 * bt;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = 2 * nf;
  out[11] = 0;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = (far + near) * nf;
  out[15] = 1;
  return out;
}
var ortho = orthoNO;
function orthoZO(out, left, right, bottom, top, near, far) {
  var lr = 1 / (left - right);
  var bt = 1 / (bottom - top);
  var nf = 1 / (near - far);
  out[0] = -2 * lr;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = -2 * bt;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = nf;
  out[11] = 0;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = near * nf;
  out[15] = 1;
  return out;
}
function lookAt(out, eye, center, up) {
  var x0, x1, x2, y0, y1, y2, z0, z1, z2, len4;
  var eyex = eye[0];
  var eyey = eye[1];
  var eyez = eye[2];
  var upx = up[0];
  var upy = up[1];
  var upz = up[2];
  var centerx = center[0];
  var centery = center[1];
  var centerz = center[2];
  if (Math.abs(eyex - centerx) < EPSILON && Math.abs(eyey - centery) < EPSILON && Math.abs(eyez - centerz) < EPSILON) {
    return identity2(out);
  }
  z0 = eyex - centerx;
  z1 = eyey - centery;
  z2 = eyez - centerz;
  len4 = 1 / Math.hypot(z0, z1, z2);
  z0 *= len4;
  z1 *= len4;
  z2 *= len4;
  x0 = upy * z2 - upz * z1;
  x1 = upz * z0 - upx * z2;
  x2 = upx * z1 - upy * z0;
  len4 = Math.hypot(x0, x1, x2);
  if (!len4) {
    x0 = 0;
    x1 = 0;
    x2 = 0;
  } else {
    len4 = 1 / len4;
    x0 *= len4;
    x1 *= len4;
    x2 *= len4;
  }
  y0 = z1 * x2 - z2 * x1;
  y1 = z2 * x0 - z0 * x2;
  y2 = z0 * x1 - z1 * x0;
  len4 = Math.hypot(y0, y1, y2);
  if (!len4) {
    y0 = 0;
    y1 = 0;
    y2 = 0;
  } else {
    len4 = 1 / len4;
    y0 *= len4;
    y1 *= len4;
    y2 *= len4;
  }
  out[0] = x0;
  out[1] = y0;
  out[2] = z0;
  out[3] = 0;
  out[4] = x1;
  out[5] = y1;
  out[6] = z1;
  out[7] = 0;
  out[8] = x2;
  out[9] = y2;
  out[10] = z2;
  out[11] = 0;
  out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
  out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
  out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
  out[15] = 1;
  return out;
}
function targetTo(out, eye, target, up) {
  var eyex = eye[0], eyey = eye[1], eyez = eye[2], upx = up[0], upy = up[1], upz = up[2];
  var z0 = eyex - target[0], z1 = eyey - target[1], z2 = eyez - target[2];
  var len4 = z0 * z0 + z1 * z1 + z2 * z2;
  if (len4 > 0) {
    len4 = 1 / Math.sqrt(len4);
    z0 *= len4;
    z1 *= len4;
    z2 *= len4;
  }
  var x0 = upy * z2 - upz * z1, x1 = upz * z0 - upx * z2, x2 = upx * z1 - upy * z0;
  len4 = x0 * x0 + x1 * x1 + x2 * x2;
  if (len4 > 0) {
    len4 = 1 / Math.sqrt(len4);
    x0 *= len4;
    x1 *= len4;
    x2 *= len4;
  }
  out[0] = x0;
  out[1] = x1;
  out[2] = x2;
  out[3] = 0;
  out[4] = z1 * x2 - z2 * x1;
  out[5] = z2 * x0 - z0 * x2;
  out[6] = z0 * x1 - z1 * x0;
  out[7] = 0;
  out[8] = z0;
  out[9] = z1;
  out[10] = z2;
  out[11] = 0;
  out[12] = eyex;
  out[13] = eyey;
  out[14] = eyez;
  out[15] = 1;
  return out;
}
function str2(a) {
  return "mat4(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ", " + a[8] + ", " + a[9] + ", " + a[10] + ", " + a[11] + ", " + a[12] + ", " + a[13] + ", " + a[14] + ", " + a[15] + ")";
}
function frob2(a) {
  return Math.hypot(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13], a[14], a[15]);
}
function add2(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  out[3] = a[3] + b[3];
  out[4] = a[4] + b[4];
  out[5] = a[5] + b[5];
  out[6] = a[6] + b[6];
  out[7] = a[7] + b[7];
  out[8] = a[8] + b[8];
  out[9] = a[9] + b[9];
  out[10] = a[10] + b[10];
  out[11] = a[11] + b[11];
  out[12] = a[12] + b[12];
  out[13] = a[13] + b[13];
  out[14] = a[14] + b[14];
  out[15] = a[15] + b[15];
  return out;
}
function subtract2(out, a, b) {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  out[3] = a[3] - b[3];
  out[4] = a[4] - b[4];
  out[5] = a[5] - b[5];
  out[6] = a[6] - b[6];
  out[7] = a[7] - b[7];
  out[8] = a[8] - b[8];
  out[9] = a[9] - b[9];
  out[10] = a[10] - b[10];
  out[11] = a[11] - b[11];
  out[12] = a[12] - b[12];
  out[13] = a[13] - b[13];
  out[14] = a[14] - b[14];
  out[15] = a[15] - b[15];
  return out;
}
function multiplyScalar2(out, a, b) {
  out[0] = a[0] * b;
  out[1] = a[1] * b;
  out[2] = a[2] * b;
  out[3] = a[3] * b;
  out[4] = a[4] * b;
  out[5] = a[5] * b;
  out[6] = a[6] * b;
  out[7] = a[7] * b;
  out[8] = a[8] * b;
  out[9] = a[9] * b;
  out[10] = a[10] * b;
  out[11] = a[11] * b;
  out[12] = a[12] * b;
  out[13] = a[13] * b;
  out[14] = a[14] * b;
  out[15] = a[15] * b;
  return out;
}
function multiplyScalarAndAdd2(out, a, b, scale6) {
  out[0] = a[0] + b[0] * scale6;
  out[1] = a[1] + b[1] * scale6;
  out[2] = a[2] + b[2] * scale6;
  out[3] = a[3] + b[3] * scale6;
  out[4] = a[4] + b[4] * scale6;
  out[5] = a[5] + b[5] * scale6;
  out[6] = a[6] + b[6] * scale6;
  out[7] = a[7] + b[7] * scale6;
  out[8] = a[8] + b[8] * scale6;
  out[9] = a[9] + b[9] * scale6;
  out[10] = a[10] + b[10] * scale6;
  out[11] = a[11] + b[11] * scale6;
  out[12] = a[12] + b[12] * scale6;
  out[13] = a[13] + b[13] * scale6;
  out[14] = a[14] + b[14] * scale6;
  out[15] = a[15] + b[15] * scale6;
  return out;
}
function exactEquals2(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8] && a[9] === b[9] && a[10] === b[10] && a[11] === b[11] && a[12] === b[12] && a[13] === b[13] && a[14] === b[14] && a[15] === b[15];
}
function equals3(a, b) {
  var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
  var a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
  var a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
  var a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];
  var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  var b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
  var b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
  var b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
  return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7)) && Math.abs(a8 - b8) <= EPSILON * Math.max(1, Math.abs(a8), Math.abs(b8)) && Math.abs(a9 - b9) <= EPSILON * Math.max(1, Math.abs(a9), Math.abs(b9)) && Math.abs(a10 - b10) <= EPSILON * Math.max(1, Math.abs(a10), Math.abs(b10)) && Math.abs(a11 - b11) <= EPSILON * Math.max(1, Math.abs(a11), Math.abs(b11)) && Math.abs(a12 - b12) <= EPSILON * Math.max(1, Math.abs(a12), Math.abs(b12)) && Math.abs(a13 - b13) <= EPSILON * Math.max(1, Math.abs(a13), Math.abs(b13)) && Math.abs(a14 - b14) <= EPSILON * Math.max(1, Math.abs(a14), Math.abs(b14)) && Math.abs(a15 - b15) <= EPSILON * Math.max(1, Math.abs(a15), Math.abs(b15));
}
var mul2 = multiply2;
var sub2 = subtract2;

// /projects/Novorender/ts/node_modules/gl-matrix/esm/vec3.js
var vec3_exports = {};
__export(vec3_exports, {
  add: () => add3,
  angle: () => angle,
  bezier: () => bezier,
  ceil: () => ceil,
  clone: () => clone3,
  copy: () => copy3,
  create: () => create3,
  cross: () => cross,
  dist: () => dist,
  distance: () => distance,
  div: () => div,
  divide: () => divide,
  dot: () => dot,
  equals: () => equals4,
  exactEquals: () => exactEquals3,
  floor: () => floor,
  forEach: () => forEach,
  fromValues: () => fromValues3,
  hermite: () => hermite,
  inverse: () => inverse,
  len: () => len,
  length: () => length,
  lerp: () => lerp,
  max: () => max,
  min: () => min,
  mul: () => mul3,
  multiply: () => multiply3,
  negate: () => negate,
  normalize: () => normalize,
  random: () => random,
  rotateX: () => rotateX2,
  rotateY: () => rotateY2,
  rotateZ: () => rotateZ2,
  round: () => round,
  scale: () => scale3,
  scaleAndAdd: () => scaleAndAdd,
  set: () => set3,
  sqrDist: () => sqrDist,
  sqrLen: () => sqrLen,
  squaredDistance: () => squaredDistance,
  squaredLength: () => squaredLength,
  str: () => str3,
  sub: () => sub3,
  subtract: () => subtract3,
  transformMat3: () => transformMat3,
  transformMat4: () => transformMat4,
  transformQuat: () => transformQuat,
  zero: () => zero
});
function create3() {
  var out = new ARRAY_TYPE(3);
  if (ARRAY_TYPE != Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}
function clone3(a) {
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
function fromValues3(x, y, z) {
  var out = new ARRAY_TYPE(3);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}
function copy3(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}
function set3(out, x, y, z) {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}
function add3(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}
function subtract3(out, a, b) {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}
function multiply3(out, a, b) {
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
function scale3(out, a, b) {
  out[0] = a[0] * b;
  out[1] = a[1] * b;
  out[2] = a[2] * b;
  return out;
}
function scaleAndAdd(out, a, b, scale6) {
  out[0] = a[0] + b[0] * scale6;
  out[1] = a[1] + b[1] * scale6;
  out[2] = a[2] + b[2] * scale6;
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
  var len4 = x * x + y * y + z * z;
  if (len4 > 0) {
    len4 = 1 / Math.sqrt(len4);
  }
  out[0] = a[0] * len4;
  out[1] = a[1] * len4;
  out[2] = a[2] * len4;
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
function random(out, scale6) {
  scale6 = scale6 || 1;
  var r = RANDOM() * 2 * Math.PI;
  var z = RANDOM() * 2 - 1;
  var zScale = Math.sqrt(1 - z * z) * scale6;
  out[0] = Math.cos(r) * zScale;
  out[1] = Math.sin(r) * zScale;
  out[2] = z * scale6;
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
function rotateX2(out, a, b, rad) {
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
function rotateY2(out, a, b, rad) {
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
function rotateZ2(out, a, b, rad) {
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
function str3(a) {
  return "vec3(" + a[0] + ", " + a[1] + ", " + a[2] + ")";
}
function exactEquals3(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
function equals4(a, b) {
  var a0 = a[0], a1 = a[1], a2 = a[2];
  var b0 = b[0], b1 = b[1], b2 = b[2];
  return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2));
}
var sub3 = subtract3;
var mul3 = multiply3;
var div = divide;
var dist = distance;
var sqrDist = squaredDistance;
var len = length;
var sqrLen = squaredLength;
var forEach = function() {
  var vec = create3();
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

// /projects/Novorender/ts/node_modules/gl-matrix/esm/vec4.js
var vec4_exports = {};
__export(vec4_exports, {
  add: () => add4,
  ceil: () => ceil2,
  clone: () => clone4,
  copy: () => copy4,
  create: () => create4,
  cross: () => cross2,
  dist: () => dist2,
  distance: () => distance2,
  div: () => div2,
  divide: () => divide2,
  dot: () => dot2,
  equals: () => equals5,
  exactEquals: () => exactEquals4,
  floor: () => floor2,
  forEach: () => forEach2,
  fromValues: () => fromValues4,
  inverse: () => inverse2,
  len: () => len2,
  length: () => length2,
  lerp: () => lerp2,
  max: () => max2,
  min: () => min2,
  mul: () => mul4,
  multiply: () => multiply4,
  negate: () => negate2,
  normalize: () => normalize2,
  random: () => random2,
  round: () => round2,
  scale: () => scale4,
  scaleAndAdd: () => scaleAndAdd2,
  set: () => set4,
  sqrDist: () => sqrDist2,
  sqrLen: () => sqrLen2,
  squaredDistance: () => squaredDistance2,
  squaredLength: () => squaredLength2,
  str: () => str4,
  sub: () => sub4,
  subtract: () => subtract4,
  transformMat4: () => transformMat42,
  transformQuat: () => transformQuat2,
  zero: () => zero2
});
function create4() {
  var out = new ARRAY_TYPE(4);
  if (ARRAY_TYPE != Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
  }
  return out;
}
function clone4(a) {
  var out = new ARRAY_TYPE(4);
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  return out;
}
function fromValues4(x, y, z, w) {
  var out = new ARRAY_TYPE(4);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
  return out;
}
function copy4(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  return out;
}
function set4(out, x, y, z, w) {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
  return out;
}
function add4(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  out[3] = a[3] + b[3];
  return out;
}
function subtract4(out, a, b) {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  out[3] = a[3] - b[3];
  return out;
}
function multiply4(out, a, b) {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  out[2] = a[2] * b[2];
  out[3] = a[3] * b[3];
  return out;
}
function divide2(out, a, b) {
  out[0] = a[0] / b[0];
  out[1] = a[1] / b[1];
  out[2] = a[2] / b[2];
  out[3] = a[3] / b[3];
  return out;
}
function ceil2(out, a) {
  out[0] = Math.ceil(a[0]);
  out[1] = Math.ceil(a[1]);
  out[2] = Math.ceil(a[2]);
  out[3] = Math.ceil(a[3]);
  return out;
}
function floor2(out, a) {
  out[0] = Math.floor(a[0]);
  out[1] = Math.floor(a[1]);
  out[2] = Math.floor(a[2]);
  out[3] = Math.floor(a[3]);
  return out;
}
function min2(out, a, b) {
  out[0] = Math.min(a[0], b[0]);
  out[1] = Math.min(a[1], b[1]);
  out[2] = Math.min(a[2], b[2]);
  out[3] = Math.min(a[3], b[3]);
  return out;
}
function max2(out, a, b) {
  out[0] = Math.max(a[0], b[0]);
  out[1] = Math.max(a[1], b[1]);
  out[2] = Math.max(a[2], b[2]);
  out[3] = Math.max(a[3], b[3]);
  return out;
}
function round2(out, a) {
  out[0] = Math.round(a[0]);
  out[1] = Math.round(a[1]);
  out[2] = Math.round(a[2]);
  out[3] = Math.round(a[3]);
  return out;
}
function scale4(out, a, b) {
  out[0] = a[0] * b;
  out[1] = a[1] * b;
  out[2] = a[2] * b;
  out[3] = a[3] * b;
  return out;
}
function scaleAndAdd2(out, a, b, scale6) {
  out[0] = a[0] + b[0] * scale6;
  out[1] = a[1] + b[1] * scale6;
  out[2] = a[2] + b[2] * scale6;
  out[3] = a[3] + b[3] * scale6;
  return out;
}
function distance2(a, b) {
  var x = b[0] - a[0];
  var y = b[1] - a[1];
  var z = b[2] - a[2];
  var w = b[3] - a[3];
  return Math.hypot(x, y, z, w);
}
function squaredDistance2(a, b) {
  var x = b[0] - a[0];
  var y = b[1] - a[1];
  var z = b[2] - a[2];
  var w = b[3] - a[3];
  return x * x + y * y + z * z + w * w;
}
function length2(a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  var w = a[3];
  return Math.hypot(x, y, z, w);
}
function squaredLength2(a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  var w = a[3];
  return x * x + y * y + z * z + w * w;
}
function negate2(out, a) {
  out[0] = -a[0];
  out[1] = -a[1];
  out[2] = -a[2];
  out[3] = -a[3];
  return out;
}
function inverse2(out, a) {
  out[0] = 1 / a[0];
  out[1] = 1 / a[1];
  out[2] = 1 / a[2];
  out[3] = 1 / a[3];
  return out;
}
function normalize2(out, a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  var w = a[3];
  var len4 = x * x + y * y + z * z + w * w;
  if (len4 > 0) {
    len4 = 1 / Math.sqrt(len4);
  }
  out[0] = x * len4;
  out[1] = y * len4;
  out[2] = z * len4;
  out[3] = w * len4;
  return out;
}
function dot2(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}
function cross2(out, u, v, w) {
  var A = v[0] * w[1] - v[1] * w[0], B = v[0] * w[2] - v[2] * w[0], C = v[0] * w[3] - v[3] * w[0], D = v[1] * w[2] - v[2] * w[1], E = v[1] * w[3] - v[3] * w[1], F = v[2] * w[3] - v[3] * w[2];
  var G = u[0];
  var H = u[1];
  var I = u[2];
  var J = u[3];
  out[0] = H * F - I * E + J * D;
  out[1] = -(G * F) + I * C - J * B;
  out[2] = G * E - H * C + J * A;
  out[3] = -(G * D) + H * B - I * A;
  return out;
}
function lerp2(out, a, b, t) {
  var ax = a[0];
  var ay = a[1];
  var az = a[2];
  var aw = a[3];
  out[0] = ax + t * (b[0] - ax);
  out[1] = ay + t * (b[1] - ay);
  out[2] = az + t * (b[2] - az);
  out[3] = aw + t * (b[3] - aw);
  return out;
}
function random2(out, scale6) {
  scale6 = scale6 || 1;
  var v1, v2, v3, v4;
  var s1, s2;
  do {
    v1 = RANDOM() * 2 - 1;
    v2 = RANDOM() * 2 - 1;
    s1 = v1 * v1 + v2 * v2;
  } while (s1 >= 1);
  do {
    v3 = RANDOM() * 2 - 1;
    v4 = RANDOM() * 2 - 1;
    s2 = v3 * v3 + v4 * v4;
  } while (s2 >= 1);
  var d = Math.sqrt((1 - s1) / s2);
  out[0] = scale6 * v1;
  out[1] = scale6 * v2;
  out[2] = scale6 * v3 * d;
  out[3] = scale6 * v4 * d;
  return out;
}
function transformMat42(out, a, m) {
  var x = a[0], y = a[1], z = a[2], w = a[3];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
  return out;
}
function transformQuat2(out, a, q) {
  var x = a[0], y = a[1], z = a[2];
  var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  var ix = qw * x + qy * z - qz * y;
  var iy = qw * y + qz * x - qx * z;
  var iz = qw * z + qx * y - qy * x;
  var iw = -qx * x - qy * y - qz * z;
  out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  out[3] = a[3];
  return out;
}
function zero2(out) {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  return out;
}
function str4(a) {
  return "vec4(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ")";
}
function exactEquals4(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
function equals5(a, b) {
  var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
  var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3));
}
var sub4 = subtract4;
var mul4 = multiply4;
var div2 = divide2;
var dist2 = distance2;
var sqrDist2 = squaredDistance2;
var len2 = length2;
var sqrLen2 = squaredLength2;
var forEach2 = function() {
  var vec = create4();
  return function(a, stride, offset, count, fn, arg) {
    var i, l;
    if (!stride) {
      stride = 4;
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
      vec[3] = a[i + 3];
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
      a[i + 2] = vec[2];
      a[i + 3] = vec[3];
    }
    return a;
  };
}();

// /projects/Novorender/ts/node_modules/gl-matrix/esm/vec2.js
var vec2_exports = {};
__export(vec2_exports, {
  add: () => add5,
  angle: () => angle2,
  ceil: () => ceil3,
  clone: () => clone5,
  copy: () => copy5,
  create: () => create5,
  cross: () => cross3,
  dist: () => dist3,
  distance: () => distance3,
  div: () => div3,
  divide: () => divide3,
  dot: () => dot3,
  equals: () => equals6,
  exactEquals: () => exactEquals5,
  floor: () => floor3,
  forEach: () => forEach3,
  fromValues: () => fromValues5,
  inverse: () => inverse3,
  len: () => len3,
  length: () => length3,
  lerp: () => lerp3,
  max: () => max3,
  min: () => min3,
  mul: () => mul5,
  multiply: () => multiply5,
  negate: () => negate3,
  normalize: () => normalize3,
  random: () => random3,
  rotate: () => rotate3,
  round: () => round3,
  scale: () => scale5,
  scaleAndAdd: () => scaleAndAdd3,
  set: () => set5,
  sqrDist: () => sqrDist3,
  sqrLen: () => sqrLen3,
  squaredDistance: () => squaredDistance3,
  squaredLength: () => squaredLength3,
  str: () => str5,
  sub: () => sub5,
  subtract: () => subtract5,
  transformMat2: () => transformMat2,
  transformMat2d: () => transformMat2d,
  transformMat3: () => transformMat32,
  transformMat4: () => transformMat43,
  zero: () => zero3
});
function create5() {
  var out = new ARRAY_TYPE(2);
  if (ARRAY_TYPE != Float32Array) {
    out[0] = 0;
    out[1] = 0;
  }
  return out;
}
function clone5(a) {
  var out = new ARRAY_TYPE(2);
  out[0] = a[0];
  out[1] = a[1];
  return out;
}
function fromValues5(x, y) {
  var out = new ARRAY_TYPE(2);
  out[0] = x;
  out[1] = y;
  return out;
}
function copy5(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  return out;
}
function set5(out, x, y) {
  out[0] = x;
  out[1] = y;
  return out;
}
function add5(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  return out;
}
function subtract5(out, a, b) {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  return out;
}
function multiply5(out, a, b) {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  return out;
}
function divide3(out, a, b) {
  out[0] = a[0] / b[0];
  out[1] = a[1] / b[1];
  return out;
}
function ceil3(out, a) {
  out[0] = Math.ceil(a[0]);
  out[1] = Math.ceil(a[1]);
  return out;
}
function floor3(out, a) {
  out[0] = Math.floor(a[0]);
  out[1] = Math.floor(a[1]);
  return out;
}
function min3(out, a, b) {
  out[0] = Math.min(a[0], b[0]);
  out[1] = Math.min(a[1], b[1]);
  return out;
}
function max3(out, a, b) {
  out[0] = Math.max(a[0], b[0]);
  out[1] = Math.max(a[1], b[1]);
  return out;
}
function round3(out, a) {
  out[0] = Math.round(a[0]);
  out[1] = Math.round(a[1]);
  return out;
}
function scale5(out, a, b) {
  out[0] = a[0] * b;
  out[1] = a[1] * b;
  return out;
}
function scaleAndAdd3(out, a, b, scale6) {
  out[0] = a[0] + b[0] * scale6;
  out[1] = a[1] + b[1] * scale6;
  return out;
}
function distance3(a, b) {
  var x = b[0] - a[0], y = b[1] - a[1];
  return Math.hypot(x, y);
}
function squaredDistance3(a, b) {
  var x = b[0] - a[0], y = b[1] - a[1];
  return x * x + y * y;
}
function length3(a) {
  var x = a[0], y = a[1];
  return Math.hypot(x, y);
}
function squaredLength3(a) {
  var x = a[0], y = a[1];
  return x * x + y * y;
}
function negate3(out, a) {
  out[0] = -a[0];
  out[1] = -a[1];
  return out;
}
function inverse3(out, a) {
  out[0] = 1 / a[0];
  out[1] = 1 / a[1];
  return out;
}
function normalize3(out, a) {
  var x = a[0], y = a[1];
  var len4 = x * x + y * y;
  if (len4 > 0) {
    len4 = 1 / Math.sqrt(len4);
  }
  out[0] = a[0] * len4;
  out[1] = a[1] * len4;
  return out;
}
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}
function cross3(out, a, b) {
  var z = a[0] * b[1] - a[1] * b[0];
  out[0] = out[1] = 0;
  out[2] = z;
  return out;
}
function lerp3(out, a, b, t) {
  var ax = a[0], ay = a[1];
  out[0] = ax + t * (b[0] - ax);
  out[1] = ay + t * (b[1] - ay);
  return out;
}
function random3(out, scale6) {
  scale6 = scale6 || 1;
  var r = RANDOM() * 2 * Math.PI;
  out[0] = Math.cos(r) * scale6;
  out[1] = Math.sin(r) * scale6;
  return out;
}
function transformMat2(out, a, m) {
  var x = a[0], y = a[1];
  out[0] = m[0] * x + m[2] * y;
  out[1] = m[1] * x + m[3] * y;
  return out;
}
function transformMat2d(out, a, m) {
  var x = a[0], y = a[1];
  out[0] = m[0] * x + m[2] * y + m[4];
  out[1] = m[1] * x + m[3] * y + m[5];
  return out;
}
function transformMat32(out, a, m) {
  var x = a[0], y = a[1];
  out[0] = m[0] * x + m[3] * y + m[6];
  out[1] = m[1] * x + m[4] * y + m[7];
  return out;
}
function transformMat43(out, a, m) {
  var x = a[0];
  var y = a[1];
  out[0] = m[0] * x + m[4] * y + m[12];
  out[1] = m[1] * x + m[5] * y + m[13];
  return out;
}
function rotate3(out, a, b, rad) {
  var p0 = a[0] - b[0], p1 = a[1] - b[1], sinC = Math.sin(rad), cosC = Math.cos(rad);
  out[0] = p0 * cosC - p1 * sinC + b[0];
  out[1] = p0 * sinC + p1 * cosC + b[1];
  return out;
}
function angle2(a, b) {
  var x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1], mag = Math.sqrt(x1 * x1 + y1 * y1) * Math.sqrt(x2 * x2 + y2 * y2), cosine = mag && (x1 * x2 + y1 * y2) / mag;
  return Math.acos(Math.min(Math.max(cosine, -1), 1));
}
function zero3(out) {
  out[0] = 0;
  out[1] = 0;
  return out;
}
function str5(a) {
  return "vec2(" + a[0] + ", " + a[1] + ")";
}
function exactEquals5(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}
function equals6(a, b) {
  var a0 = a[0], a1 = a[1];
  var b0 = b[0], b1 = b[1];
  return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1));
}
var len3 = length3;
var sub5 = subtract5;
var mul5 = multiply5;
var div3 = divide3;
var dist3 = distance3;
var sqrDist3 = squaredDistance3;
var sqrLen3 = squaredLength3;
var forEach3 = function() {
  var vec = create5();
  return function(a, stride, offset, count, fn, arg) {
    var i, l;
    if (!stride) {
      stride = 2;
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
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
    }
    return a;
  };
}();

// /projects/Novorender/ts/dist/measure/worker/nurbs.ts
function makeNurbsCurve3D(instance, knots, controlPoints, weights, order) {
  const degree2 = order - 1;
  var knotsPtr = instance._malloc(8 * knots.length);
  var knotsHeap = new Float64Array(instance.HEAPF64.buffer, knotsPtr, knots.length);
  knotsHeap.set(knots);
  var controlPointsPtr = instance._malloc(controlPoints.length * 24);
  var controlPointsHeap = new Float64Array(instance.HEAPF64.buffer, controlPointsPtr, controlPoints.length * 3);
  var ctrlPoints = new Float64Array(controlPoints.length * 3);
  controlPoints.forEach((point, index) => {
    ctrlPoints[index * 3] = point[0];
    ctrlPoints[index * 3 + 1] = point[1];
    ctrlPoints[index * 3 + 2] = point[2];
  });
  controlPointsHeap.set(ctrlPoints);
  var nurbs = void 0;
  if (weights != void 0 && weights.length > 0) {
    var weightsPtr = instance._malloc(8 * weights.length);
    var weightsHeap = new Float64Array(instance.HEAPF64.buffer, weightsPtr, weights.length);
    weightsHeap.set(weights);
    nurbs = instance._getNurbsCurve3DWithWeights(
      degree2,
      controlPoints.length,
      knotsHeap.byteOffset,
      controlPointsHeap.byteOffset,
      weightsHeap.byteOffset
    );
    instance._free(weightsHeap.byteOffset);
  } else {
    nurbs = instance._getNurbsCurve3D(
      degree2,
      controlPoints.length,
      knotsHeap.byteOffset,
      controlPointsHeap.byteOffset,
      0
    );
  }
  instance._free(knotsHeap.byteOffset);
  instance._free(controlPointsHeap.byteOffset);
  return nurbs;
}
function makeNurbsCurve2D(instance, knots, controlPoints, weights, order) {
  const degree2 = order - 1;
  var knotsPtr = instance._malloc(8 * knots.length);
  var knotsHeap = new Float64Array(instance.HEAPF64.buffer, knotsPtr, knots.length);
  knotsHeap.set(knots);
  var controlPointsPtr = instance._malloc(controlPoints.length * 16);
  var controlPointsHeap = new Float64Array(instance.HEAPF64.buffer, controlPointsPtr, controlPoints.length * 2);
  var ctrlPoints = new Float64Array(controlPoints.length * 2);
  controlPoints.forEach((point, index) => {
    ctrlPoints[index * 2] = point[0];
    ctrlPoints[index * 2 + 1] = point[1];
  });
  controlPointsHeap.set(ctrlPoints);
  var nurbs = void 0;
  if (weights != void 0 && weights.length > 0) {
    var weightsPtr = instance._malloc(8 * weights.length);
    var weightsHeap = new Float64Array(instance.HEAPF64.buffer, weightsPtr, weights.length);
    weightsHeap.set(weights);
    nurbs = instance._getNurbsCurve2DWithWeights(
      degree2,
      controlPoints.length,
      knotsHeap.byteOffset,
      controlPointsHeap.byteOffset,
      weightsHeap.byteOffset
    );
    instance._free(weightsHeap.byteOffset);
  } else {
    nurbs = instance._getNurbsCurve2D(
      degree2,
      controlPoints.length,
      knotsHeap.byteOffset,
      controlPointsHeap.byteOffset,
      0
    );
  }
  instance._free(knotsHeap.byteOffset);
  instance._free(controlPointsHeap.byteOffset);
  return nurbs;
}
function makeNurbsSurface(instance, knots, dimU, dimV, controlPoints, weights, orderU, orderV) {
  const degreeU = orderU - 1;
  const degreeV = orderV - 1;
  var knotsPtr = instance._malloc(8 * knots.length);
  var knotsHeap = new Float64Array(instance.HEAPF64.buffer, knotsPtr, knots.length);
  knotsHeap.set(knots);
  var controlPointsPtr = instance._malloc(controlPoints.length * 24);
  var controlPointsHeap = new Float64Array(instance.HEAPF64.buffer, controlPointsPtr, controlPoints.length * 3);
  var ctrlPoints = new Float64Array(controlPoints.length * 3);
  controlPoints.forEach((point, index) => {
    ctrlPoints[index * 3] = point[0];
    ctrlPoints[index * 3 + 1] = point[1];
    ctrlPoints[index * 3 + 2] = point[2];
  });
  controlPointsHeap.set(ctrlPoints);
  var nurbs = void 0;
  if (weights != void 0 && weights.length > 0) {
    var weightsPtr = instance._malloc(8 * weights.length);
    var weightsHeap = new Float64Array(instance.HEAPF64.buffer, weightsPtr, weights.length);
    weightsHeap.set(weights);
    nurbs = instance._getNurbsSurfaceWithWeights(
      degreeU,
      degreeV,
      dimU,
      dimV,
      knotsHeap.byteOffset,
      controlPointsHeap.byteOffset,
      weightsHeap.byteOffset
    );
    instance._free(weightsHeap.byteOffset);
  } else {
    nurbs = instance._getNurbsSurface(
      degreeU,
      degreeV,
      dimU,
      dimV,
      knotsHeap.byteOffset,
      controlPointsHeap.byteOffset,
      0
    );
  }
  instance._free(knotsHeap.byteOffset);
  instance._free(controlPointsHeap.byteOffset);
  return nurbs;
}

// /projects/Novorender/ts/dist/measure/worker/face.ts
common_exports.setMatrixArrayType(Array);
var projectedPoint = vec2_exports.create();
var projectedTangent = vec2_exports.create();
var beginUV = vec2_exports.create();
var endUV = vec2_exports.create();
var Face = class {
  constructor(surface, sense, loops, triangulation, seams, instanceIndex, geometryTransformation) {
    this.surface = surface;
    this.sense = sense;
    this.loops = loops;
    this.triangulation = triangulation;
    this.seams = seams;
    this.instanceIndex = instanceIndex;
    this.geometryTransformation = geometryTransformation;
  }
  raytrace(uvOut, ray) {
    if (!this.surface.intersect(uvOut, ray))
      return false;
    return true;
  }
  isInside(uv) {
    const { loops, sense } = this;
    let nearestDist = Number.MAX_VALUE;
    let inside = true;
    for (const curves of loops) {
      for (const curve of curves) {
        const t = curve.project(uv);
        curve.eval(t, projectedPoint, projectedTangent);
        const dist4 = vec2_exports.distance(uv, projectedPoint);
        if (dist4 < nearestDist) {
          nearestDist = dist4;
          vec2_exports.sub(projectedPoint, uv, projectedPoint);
          const [tx, ty] = projectedTangent;
          projectedTangent[0] = ty * sense;
          projectedTangent[1] = -tx * sense;
          inside = vec2_exports.dot(projectedTangent, projectedPoint) < 0;
        }
      }
    }
    return inside;
  }
};

// /projects/Novorender/ts/dist/measure/worker/ray.ts
common_exports.setMatrixArrayType(Array);
var tmp3 = vec3_exports.create();
var Ray = class {
  constructor(origin2, direction2) {
    this.origin = origin2;
    this.direction = direction2;
  }
  eval(pointOut, t) {
    vec3_exports.scale(pointOut, this.direction, t);
    vec3_exports.add(pointOut, pointOut, this.origin);
  }
  invert(point) {
    vec3_exports.sub(tmp3, point, this.origin);
    return vec3_exports.dot(tmp3, this.direction);
  }
};

// /projects/Novorender/ts/dist/measure/worker/surfaces.ts
common_exports.setMatrixArrayType(Array);
var tmp32 = vec3_exports.create();
var origin = vec3_exports.create();
var direction = vec3_exports.create();
var unitRay = new Ray(origin, direction);
function solveQuadraticPolynomial(a, b, c, solution = 0) {
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0 || a == 0)
    return void 0;
  const sign = Math.sign(a) * solution ? 1 : -1;
  return (-b + sign * Math.sqrt(discriminant)) / (2 * a);
}
function combineMatrices(m0, m1) {
  if (m0 && !m1)
    return m0;
  else if (!m0 && m1)
    return m1;
  else if (m0 && m1) {
    return mat4_exports.multiply(m1, m0, m1);
  }
}
function unitCylinderMatrix(radius) {
  if (radius == 1)
    return void 0;
  const m = mat4_exports.create();
  mat4_exports.fromScaling(m, vec3_exports.fromValues(radius, radius, 1));
  return m;
}
var UnitSurface = class {
  constructor(kind, surfaceToObjectSpaceTransform, sense, scale6) {
    this.kind = kind;
    this.sense = sense;
    this.scale = scale6;
    const transform = surfaceToObjectSpaceTransform ? mat4_exports.clone(surfaceToObjectSpaceTransform) : mat4_exports.create();
    const scaleMat = mat4_exports.fromScaling(mat4_exports.create(), vec3_exports.fromValues(this.scale, this.scale, this.scale));
    mat4_exports.multiply(transform, scaleMat, transform);
    this.surfaceToObjectSpaceTransform = transform;
    const objectToSurfaceSpaceTransform = mat4_exports.invert(mat4_exports.create(), this.surfaceToObjectSpaceTransform);
    this.objectToSurfaceSpaceTransform = objectToSurfaceSpaceTransform;
    let surfaceToObjectSpaceTransformNormal = mat3_exports.fromMat4(mat3_exports.create(), this.surfaceToObjectSpaceTransform);
    this.surfaceToObjectSpaceTransformNormal = surfaceToObjectSpaceTransformNormal;
    const objectToSurfaceSpaceTransformNormal = mat3_exports.fromMat4(mat3_exports.create(), this.objectToSurfaceSpaceTransform);
    this.objectToSurfaceSpaceTransformNormal = objectToSurfaceSpaceTransformNormal;
  }
  // Scale from mm to meters. Applied on functions that deal with 3D coordinate (which should be in meters), such as evalPos, invert and intersect. UV coords are still in mm since open cascade uses that unit internally and conversion is non-trivial.
  surfaceToObjectSpaceTransform;
  objectToSurfaceSpaceTransform;
  surfaceToObjectSpaceTransformNormal;
  objectToSurfaceSpaceTransformNormal;
  evalPosition(positionOut, uv) {
    this.unitEvalPosition(positionOut, uv);
    vec3_exports.transformMat4(positionOut, positionOut, this.surfaceToObjectSpaceTransform);
  }
  evalNormal(normalOut, uv) {
    this.unitEvalNormal(normalOut, uv);
    vec3_exports.scale(normalOut, normalOut, this.sense);
    vec3_exports.transformMat3(normalOut, normalOut, this.surfaceToObjectSpaceTransformNormal);
    vec3_exports.normalize(normalOut, normalOut);
  }
  invert(uvOut, point) {
    vec3_exports.transformMat4(tmp32, point, this.objectToSurfaceSpaceTransform);
    this.unitInvert(uvOut, tmp32);
  }
  intersect(uvOut, ray) {
    vec3_exports.transformMat4(origin, ray.origin, this.objectToSurfaceSpaceTransform);
    vec3_exports.transformMat3(direction, ray.direction, this.objectToSurfaceSpaceTransformNormal);
    const t = this.unitIntersect(unitRay);
    if (!t)
      return false;
    unitRay.eval(tmp32, t);
    this.unitInvert(uvOut, tmp32);
    return true;
  }
  dispose() {
  }
};
var Plane = class extends UnitSurface {
  constructor(surfaceToObjectSpaceTransform, sense = 1, scale6) {
    super("plane", surfaceToObjectSpaceTransform, sense, scale6 ?? 1);
  }
  unitEvalPosition(positionOut, uv) {
    vec3_exports.set(positionOut, uv[0], uv[1], 0);
  }
  unitEvalNormal(normalOut, uv) {
    vec3_exports.set(normalOut, 0, 0, 1);
  }
  unitInvert(uvOut, point) {
    return vec2_exports.set(uvOut, point[0], point[1]);
  }
  unitIntersect(ray) {
    if (ray.direction[2] * this.sense < 0) {
      const t = -ray.origin[2] / ray.direction[2];
      return t;
    }
  }
};
var Cylinder = class extends UnitSurface {
  constructor(radius = 1, surfaceToObjectSpaceTransform, sense = 1, scale6) {
    super("cylinder", combineMatrices(surfaceToObjectSpaceTransform, unitCylinderMatrix(radius)), sense * matrixInversion(surfaceToObjectSpaceTransform), scale6 ?? 1);
    this.radius = radius;
  }
  unitEvalPosition(positionOut, uv) {
    vec3_exports.set(positionOut, Math.cos(uv[0]), Math.sin(uv[0]), uv[1]);
  }
  unitEvalNormal(normalOut, uv) {
    vec3_exports.set(normalOut, Math.cos(uv[0]), Math.sin(uv[0]), 0);
  }
  unitInvert(uvOut, point) {
    const [x, y, z] = point;
    let u = Math.atan2(y, x);
    if (u < 0)
      u += Math.PI * 2;
    vec2_exports.set(uvOut, u, z);
  }
  unitIntersect(ray) {
    const { origin: origin2, direction: direction2 } = ray;
    const [x0, y0] = origin2;
    const [dx, dy] = direction2;
    const a = dx * dx + dy * dy;
    const b = 2 * (x0 * dx + y0 * dy);
    const c = x0 * x0 + y0 * y0 - 1;
    const t = solveQuadraticPolynomial(a, b, c, this.sense > 0 ? 0 : 1);
    return t;
  }
};
function unitConeMatrix(halfAngleTan, radius) {
  if (halfAngleTan == 1)
    return void 0;
  const scaleXY = 1;
  const scaleZ = 1 / halfAngleTan;
  const s = mat4_exports.create();
  const t = mat4_exports.create();
  const m = mat4_exports.create();
  mat4_exports.fromTranslation(t, vec3_exports.fromValues(0, 0, radius * Math.sign(halfAngleTan)));
  mat4_exports.fromScaling(s, vec3_exports.fromValues(scaleXY, scaleXY, scaleZ));
  mat4_exports.multiply(m, s, t);
  return m;
}
function matrixInversion(m) {
  if (!m)
    return 1;
  const [e00, e01, e02, e03, e10, e11, e12, e13, e20, e21, e22, e23, e30, e31, e32, e33] = m;
  const x = vec3_exports.fromValues(e00, e10, e20);
  const y = vec3_exports.fromValues(e01, e11, e21);
  const z = vec3_exports.fromValues(e02, e12, e22);
  const cp = vec3_exports.create();
  vec3_exports.cross(cp, x, y);
  const dp = vec3_exports.dot(cp, z);
  return dp >= 0 ? 1 : -1;
}
var Cone = class extends UnitSurface {
  // readonly offsetV;
  constructor(radius = 1, halfAngleTan = -1, surfaceToObjectSpaceTransform, sense = 1, scale6) {
    super("cone", combineMatrices(surfaceToObjectSpaceTransform, unitConeMatrix(halfAngleTan, radius)), sense * matrixInversion(surfaceToObjectSpaceTransform), scale6 ?? 1);
    this.radius = radius;
    this.halfAngleTan = halfAngleTan;
    this.scaleV = halfAngleTan * Math.cos(Math.atan(halfAngleTan));
  }
  scaleV;
  unitEvalPosition(positionOut, uv) {
    let [u, v] = uv;
    v = v * this.scaleV + this.radius;
    vec3_exports.set(positionOut, Math.cos(u) * v, Math.sin(u) * v, v);
  }
  unitEvalNormal(normalOut, uv) {
    const [u, v] = uv;
    const s = Math.sqrt(0.5);
    vec3_exports.set(normalOut, Math.cos(u) * s, Math.sin(u) * s, -s);
  }
  unitInvert(uvOut, point) {
    const [x, y, z] = point;
    let u = Math.atan2(y, x);
    if (u < 0)
      u += Math.PI * 2;
    const v = (z - this.radius) / this.scaleV;
    vec2_exports.set(uvOut, u, v);
  }
  unitIntersect(ray) {
    const { origin: origin2, direction: direction2 } = ray;
    const [x0, y0, z0] = origin2;
    const [dx, dy, dz] = direction2;
    const a = dx * dx + dy * dy - dz * dz;
    const b = 2 * (x0 * dx + y0 * dy - z0 * dz);
    const c = x0 * x0 + y0 * y0 - z0 * z0;
    const t = solveQuadraticPolynomial(a, b, c, this.sense > 0 ? 0 : 1);
    return t;
  }
};
var Torus = class extends UnitSurface {
  constructor(majorRadius = 1, minorRadius = 0.5, surfaceToObjectSpaceTransform, sense = 1, scale6) {
    super("torus", surfaceToObjectSpaceTransform, sense, scale6 ?? 1);
    this.majorRadius = majorRadius;
    this.minorRadius = minorRadius;
  }
  unitEvalPosition(positionOut, uv) {
    const [u, v] = uv;
    const { majorRadius, minorRadius } = this;
    const r = majorRadius + Math.cos(v) * minorRadius;
    vec3_exports.set(positionOut, Math.cos(u) * r, Math.sin(u) * r, Math.sin(v) * minorRadius);
  }
  unitEvalNormal(normalOut, uv) {
    const [u, v] = uv;
    vec3_exports.set(normalOut, Math.cos(u) * Math.cos(v), Math.sin(u) * Math.cos(v), Math.sin(v));
  }
  unitInvert(uvOut, point) {
    const [x, y, z] = point;
    let u = Math.atan2(y, x);
    if (u < 0)
      u += Math.PI * 2;
    let v = Math.atan2(z, Math.sqrt(x * x + y * y) - this.majorRadius);
    if (v < 0)
      v += Math.PI * 2;
    vec2_exports.set(uvOut, u, v);
  }
  unitIntersect(ray) {
    return intersectTorus(ray, this.majorRadius, this.minorRadius);
  }
};
var Nurbs = class extends UnitSurface {
  constructor(orders, dim, controlPoints, knots, weights, sense, wasmInstance, buffer, scale6) {
    super("nurbs", void 0, sense, scale6 ?? 1);
    this.orders = orders;
    this.dim = dim;
    this.controlPoints = controlPoints;
    this.knots = knots;
    this.weights = weights;
    this.sense = sense;
    this.wasmInstance = wasmInstance;
    this.buffer = buffer;
  }
  kind = "nurbs";
  ptr = 0;
  dispose() {
    if (this.weights) {
      this.wasmInstance._disposeNurbsSurface(this.ptr);
    } else {
      this.wasmInstance._disposeNurbsSurfaceWithWeights(this.ptr);
    }
  }
  unitEvalPosition(positionOut, uv) {
    if (this.ptr === 0) {
      this.ptr = makeNurbsSurface(this.wasmInstance, this.knots, this.dim[0], this.dim[1], this.controlPoints, this.weights, this.orders[0], this.orders[1]);
    }
    if (this.weights) {
      this.wasmInstance._evalNurbsSurfaceWithWeights(this.ptr, uv[0], uv[1], this.buffer.byteOffset, void 0);
    } else {
      this.wasmInstance._evalNurbsSurface(this.ptr, uv[0], uv[1], this.buffer.byteOffset, void 0);
    }
    const [x, y, z] = this.buffer.subarray(0, 3);
    vec3_exports.set(positionOut, x, y, z);
  }
  unitEvalNormal(normalOut, uv) {
    if (this.ptr === 0) {
      this.ptr = makeNurbsSurface(this.wasmInstance, this.knots, this.dim[0], this.dim[1], this.controlPoints, this.weights, this.orders[0], this.orders[1]);
    }
    if (this.weights) {
      this.wasmInstance._evalNurbsSurfaceWithWeights(this.ptr, uv[0], uv[1], void 0, this.buffer.byteOffset + 24);
    } else {
      this.wasmInstance._evalNurbsSurface(this.ptr, uv[0], uv[1], void 0, this.buffer.byteOffset + 24);
    }
    const [x, y, z] = this.buffer.subarray(3, 6);
    vec3_exports.set(normalOut, -x, -y, -z);
  }
  unitInvert(uvOut, pos) {
    if (this.ptr === 0) {
      this.ptr = makeNurbsSurface(this.wasmInstance, this.knots, this.dim[0], this.dim[1], this.controlPoints, this.weights, this.orders[0], this.orders[1]);
    }
    this.wasmInstance._invertSurface(this.ptr, pos[0], pos[1], pos[2], this.buffer.byteOffset);
    const [u, v] = this.buffer.subarray(0, 2);
    vec2_exports.set(uvOut, u, v);
  }
  unitIntersect(ray) {
    return void 0;
  }
};
function intersectTorus(ray, majorRadius, minorRadius) {
  const { origin: origin2, direction: direction2 } = ray;
  let po = 1;
  const Ra2 = majorRadius * majorRadius;
  const ra2 = minorRadius * minorRadius;
  const m = vec3_exports.dot(origin2, origin2);
  const n = vec3_exports.dot(origin2, direction2);
  {
    const h2 = n * n - m + (majorRadius + minorRadius) * (majorRadius + minorRadius);
    if (h2 < 0)
      return void 0;
  }
  const k = (m - ra2 - Ra2) / 2;
  let k3 = n;
  let k2 = n * n + Ra2 * direction2[2] * direction2[2] + k;
  let k1 = k * n + Ra2 * origin2[2] * direction2[2];
  let k0 = k * k + Ra2 * origin2[2] * origin2[2] - Ra2 * ra2;
  if (Math.abs(k3 * (k3 * k3 - k2) + k1) < 0.01) {
    po = -1;
    const tmp = k1;
    k1 = k3;
    k3 = tmp;
    k0 = 1 / k0;
    k1 = k1 * k0;
    k2 = k2 * k0;
    k3 = k3 * k0;
  }
  let c2 = 2 * k2 - 3 * k3 * k3;
  let c1 = k3 * (k3 * k3 - k2) + k1;
  let c0 = k3 * (k3 * (-3 * k3 * k3 + 4 * k2) - 8 * k1) + 4 * k0;
  c2 /= 3;
  c1 *= 2;
  c0 /= 3;
  const Q = c2 * c2 + c0;
  const R = 3 * c0 * c2 - c2 * c2 * c2 - c1 * c1;
  let h = R * R - Q * Q * Q;
  let z = 0;
  if (h < 0) {
    const sQ = Math.sqrt(Q);
    z = 2 * sQ * Math.cos(Math.acos(R / (sQ * Q)) / 3);
  } else {
    const sQ = Math.pow(Math.sqrt(h) + Math.abs(R), 1 / 3);
    z = Math.sign(R) * Math.abs(sQ + Q / sQ);
  }
  z = c2 - z;
  let d1 = z - 3 * c2;
  let d2 = z * z - 3 * c0;
  if (Math.abs(d1) < 1e-4) {
    if (d2 < 0)
      return void 0;
    d2 = Math.sqrt(d2);
  } else {
    if (d1 < 0)
      return void 0;
    d1 = Math.sqrt(d1 / 2);
    d2 = c1 / d1;
  }
  let result = Number.MAX_VALUE;
  h = d1 * d1 - z + d2;
  if (h > 0) {
    h = Math.sqrt(h);
    let t1 = -d1 - h - k3;
    t1 = po < 0 ? 2 / t1 : t1;
    let t2 = -d1 + h - k3;
    t2 = po < 0 ? 2 / t2 : t2;
    if (t1 > 0)
      result = t1;
    if (t2 > 0)
      result = Math.min(result, t2);
  }
  h = d1 * d1 - z - d2;
  if (h > 0) {
    h = Math.sqrt(h);
    let t1 = d1 - h - k3;
    t1 = po < 0 ? 2 / t1 : t1;
    let t2 = d1 + h - k3;
    t2 = po < 0 ? 2 / t2 : t2;
    if (t1 > 0)
      result = Math.min(result, t1);
    if (t2 > 0)
      result = Math.min(result, t2);
  }
  if (result != Number.MAX_VALUE)
    return result;
}

// /projects/Novorender/ts/dist/measure/worker/edge.ts
var Edge = class {
  constructor(curve, geometryTransformation, instanceIndex) {
    this.curve = curve;
    this.geometryTransformation = geometryTransformation;
    this.instanceIndex = instanceIndex;
  }
};

// /projects/Novorender/ts/dist/measure/wasm/nurbs_wrapper.js
var Module = function() {
  var _scriptDir = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : void 0;
  return function(Module2) {
    Module2 = Module2 || {};
    var Module2 = typeof Module2 !== "undefined" ? Module2 : {};
    var readyPromiseResolve, readyPromiseReject;
    Module2["ready"] = new Promise(function(resolve, reject) {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_malloc")) {
      Object.defineProperty(Module2["ready"], "_malloc", { configurable: true, get: function() {
        abort("You are getting _malloc on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_malloc", { configurable: true, set: function() {
        abort("You are setting _malloc on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_free")) {
      Object.defineProperty(Module2["ready"], "_free", { configurable: true, get: function() {
        abort("You are getting _free on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_free", { configurable: true, set: function() {
        abort("You are setting _free on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_emscripten_stack_get_end")) {
      Object.defineProperty(Module2["ready"], "_emscripten_stack_get_end", { configurable: true, get: function() {
        abort("You are getting _emscripten_stack_get_end on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_emscripten_stack_get_end", { configurable: true, set: function() {
        abort("You are setting _emscripten_stack_get_end on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_emscripten_stack_get_free")) {
      Object.defineProperty(Module2["ready"], "_emscripten_stack_get_free", { configurable: true, get: function() {
        abort("You are getting _emscripten_stack_get_free on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_emscripten_stack_get_free", { configurable: true, set: function() {
        abort("You are setting _emscripten_stack_get_free on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_emscripten_stack_init")) {
      Object.defineProperty(Module2["ready"], "_emscripten_stack_init", { configurable: true, get: function() {
        abort("You are getting _emscripten_stack_init on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_emscripten_stack_init", { configurable: true, set: function() {
        abort("You are setting _emscripten_stack_init on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_stackSave")) {
      Object.defineProperty(Module2["ready"], "_stackSave", { configurable: true, get: function() {
        abort("You are getting _stackSave on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_stackSave", { configurable: true, set: function() {
        abort("You are setting _stackSave on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_stackRestore")) {
      Object.defineProperty(Module2["ready"], "_stackRestore", { configurable: true, get: function() {
        abort("You are getting _stackRestore on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_stackRestore", { configurable: true, set: function() {
        abort("You are setting _stackRestore on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_stackAlloc")) {
      Object.defineProperty(Module2["ready"], "_stackAlloc", { configurable: true, get: function() {
        abort("You are getting _stackAlloc on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_stackAlloc", { configurable: true, set: function() {
        abort("You are setting _stackAlloc on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "___wasm_call_ctors")) {
      Object.defineProperty(Module2["ready"], "___wasm_call_ctors", { configurable: true, get: function() {
        abort("You are getting ___wasm_call_ctors on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "___wasm_call_ctors", { configurable: true, set: function() {
        abort("You are setting ___wasm_call_ctors on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_fflush")) {
      Object.defineProperty(Module2["ready"], "_fflush", { configurable: true, get: function() {
        abort("You are getting _fflush on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_fflush", { configurable: true, set: function() {
        abort("You are setting _fflush on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "___errno_location")) {
      Object.defineProperty(Module2["ready"], "___errno_location", { configurable: true, get: function() {
        abort("You are getting ___errno_location on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "___errno_location", { configurable: true, set: function() {
        abort("You are setting ___errno_location on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_getNurbsCurve2D")) {
      Object.defineProperty(Module2["ready"], "_getNurbsCurve2D", { configurable: true, get: function() {
        abort("You are getting _getNurbsCurve2D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_getNurbsCurve2D", { configurable: true, set: function() {
        abort("You are setting _getNurbsCurve2D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_getNurbsCurve2DWithWeights")) {
      Object.defineProperty(Module2["ready"], "_getNurbsCurve2DWithWeights", { configurable: true, get: function() {
        abort("You are getting _getNurbsCurve2DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_getNurbsCurve2DWithWeights", { configurable: true, set: function() {
        abort("You are setting _getNurbsCurve2DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_evalNurbsCurve2D")) {
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve2D", { configurable: true, get: function() {
        abort("You are getting _evalNurbsCurve2D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve2D", { configurable: true, set: function() {
        abort("You are setting _evalNurbsCurve2D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_evalNurbsCurve2DWithWeights")) {
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve2DWithWeights", { configurable: true, get: function() {
        abort("You are getting _evalNurbsCurve2DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve2DWithWeights", { configurable: true, set: function() {
        abort("You are setting _evalNurbsCurve2DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_projectNurbsCurve2D")) {
      Object.defineProperty(Module2["ready"], "_projectNurbsCurve2D", { configurable: true, get: function() {
        abort("You are getting _projectNurbsCurve2D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_projectNurbsCurve2D", { configurable: true, set: function() {
        abort("You are setting _projectNurbsCurve2D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_disposeNurbsCurve2D")) {
      Object.defineProperty(Module2["ready"], "_disposeNurbsCurve2D", { configurable: true, get: function() {
        abort("You are getting _disposeNurbsCurve2D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_disposeNurbsCurve2D", { configurable: true, set: function() {
        abort("You are setting _disposeNurbsCurve2D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_disposeNurbsCurve2DWithWeights")) {
      Object.defineProperty(Module2["ready"], "_disposeNurbsCurve2DWithWeights", { configurable: true, get: function() {
        abort("You are getting _disposeNurbsCurve2DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_disposeNurbsCurve2DWithWeights", { configurable: true, set: function() {
        abort("You are setting _disposeNurbsCurve2DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_getNurbsCurve3D")) {
      Object.defineProperty(Module2["ready"], "_getNurbsCurve3D", { configurable: true, get: function() {
        abort("You are getting _getNurbsCurve3D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_getNurbsCurve3D", { configurable: true, set: function() {
        abort("You are setting _getNurbsCurve3D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_getNurbsCurve3DWithWeights")) {
      Object.defineProperty(Module2["ready"], "_getNurbsCurve3DWithWeights", { configurable: true, get: function() {
        abort("You are getting _getNurbsCurve3DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_getNurbsCurve3DWithWeights", { configurable: true, set: function() {
        abort("You are setting _getNurbsCurve3DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_evalNurbsCurve3D")) {
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve3D", { configurable: true, get: function() {
        abort("You are getting _evalNurbsCurve3D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve3D", { configurable: true, set: function() {
        abort("You are setting _evalNurbsCurve3D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_invertNurbsCurve3D")) {
      Object.defineProperty(Module2["ready"], "_invertNurbsCurve3D", { configurable: true, get: function() {
        abort("You are getting _invertNurbsCurve3D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_invertNurbsCurve3D", { configurable: true, set: function() {
        abort("You are setting _invertNurbsCurve3D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_evalNurbsCurve3DWithWeights")) {
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve3DWithWeights", { configurable: true, get: function() {
        abort("You are getting _evalNurbsCurve3DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve3DWithWeights", { configurable: true, set: function() {
        abort("You are setting _evalNurbsCurve3DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_evalNurbsCurve3dBulk")) {
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve3dBulk", { configurable: true, get: function() {
        abort("You are getting _evalNurbsCurve3dBulk on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_evalNurbsCurve3dBulk", { configurable: true, set: function() {
        abort("You are setting _evalNurbsCurve3dBulk on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_disposeNurbsCurve3D")) {
      Object.defineProperty(Module2["ready"], "_disposeNurbsCurve3D", { configurable: true, get: function() {
        abort("You are getting _disposeNurbsCurve3D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_disposeNurbsCurve3D", { configurable: true, set: function() {
        abort("You are setting _disposeNurbsCurve3D on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_disposeNurbsCurve3DWithWeights")) {
      Object.defineProperty(Module2["ready"], "_disposeNurbsCurve3DWithWeights", { configurable: true, get: function() {
        abort("You are getting _disposeNurbsCurve3DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_disposeNurbsCurve3DWithWeights", { configurable: true, set: function() {
        abort("You are setting _disposeNurbsCurve3DWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_getNurbsSurface")) {
      Object.defineProperty(Module2["ready"], "_getNurbsSurface", { configurable: true, get: function() {
        abort("You are getting _getNurbsSurface on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_getNurbsSurface", { configurable: true, set: function() {
        abort("You are setting _getNurbsSurface on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_getNurbsSurfaceWithWeights")) {
      Object.defineProperty(Module2["ready"], "_getNurbsSurfaceWithWeights", { configurable: true, get: function() {
        abort("You are getting _getNurbsSurfaceWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_getNurbsSurfaceWithWeights", { configurable: true, set: function() {
        abort("You are setting _getNurbsSurfaceWithWeights on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_evalNurbsSurface")) {
      Object.defineProperty(Module2["ready"], "_evalNurbsSurface", { configurable: true, get: function() {
        abort("You are getting _evalNurbsSurface on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_evalNurbsSurface", { configurable: true, set: function() {
        abort("You are setting _evalNurbsSurface on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_evalNurbsSurfaceBulk")) {
      Object.defineProperty(Module2["ready"], "_evalNurbsSurfaceBulk", { configurable: true, get: function() {
        abort("You are getting _evalNurbsSurfaceBulk on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_evalNurbsSurfaceBulk", { configurable: true, set: function() {
        abort("You are setting _evalNurbsSurfaceBulk on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "_invertSurface")) {
      Object.defineProperty(Module2["ready"], "_invertSurface", { configurable: true, get: function() {
        abort("You are getting _invertSurface on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "_invertSurface", { configurable: true, set: function() {
        abort("You are setting _invertSurface on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "__Z19disposeNurbsSurfacePN10novo_nurbs7SurfaceIdEE")) {
      Object.defineProperty(Module2["ready"], "__Z19disposeNurbsSurfacePN10novo_nurbs7SurfaceIdEE", { configurable: true, get: function() {
        abort("You are getting __Z19disposeNurbsSurfacePN10novo_nurbs7SurfaceIdEE on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "__Z19disposeNurbsSurfacePN10novo_nurbs7SurfaceIdEE", { configurable: true, set: function() {
        abort("You are setting __Z19disposeNurbsSurfacePN10novo_nurbs7SurfaceIdEE on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "__Z30disposeNurbsSurfaceWithWeightsPN10novo_nurbs15RationalSurfaceIdEE")) {
      Object.defineProperty(Module2["ready"], "__Z30disposeNurbsSurfaceWithWeightsPN10novo_nurbs15RationalSurfaceIdEE", { configurable: true, get: function() {
        abort("You are getting __Z30disposeNurbsSurfaceWithWeightsPN10novo_nurbs15RationalSurfaceIdEE on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "__Z30disposeNurbsSurfaceWithWeightsPN10novo_nurbs15RationalSurfaceIdEE", { configurable: true, set: function() {
        abort("You are setting __Z30disposeNurbsSurfaceWithWeightsPN10novo_nurbs15RationalSurfaceIdEE on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    if (!Object.getOwnPropertyDescriptor(Module2["ready"], "onRuntimeInitialized")) {
      Object.defineProperty(Module2["ready"], "onRuntimeInitialized", { configurable: true, get: function() {
        abort("You are getting onRuntimeInitialized on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
      Object.defineProperty(Module2["ready"], "onRuntimeInitialized", { configurable: true, set: function() {
        abort("You are setting onRuntimeInitialized on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
      } });
    }
    var moduleOverrides = {};
    var key;
    for (key in Module2) {
      if (Module2.hasOwnProperty(key)) {
        moduleOverrides[key] = Module2[key];
      }
    }
    var arguments_ = [];
    var thisProgram = "./this.program";
    var quit_ = function(status, toThrow) {
      throw toThrow;
    };
    var ENVIRONMENT_IS_WEB = false;
    var ENVIRONMENT_IS_WORKER = true;
    var ENVIRONMENT_IS_NODE = false;
    var ENVIRONMENT_IS_SHELL = false;
    if (Module2["ENVIRONMENT"]) {
      throw new Error("Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -s ENVIRONMENT=web or -s ENVIRONMENT=node)");
    }
    var scriptDirectory = "";
    function locateFile(path) {
      if (Module2["locateFile"]) {
        return Module2["locateFile"](path, scriptDirectory);
      }
      return scriptDirectory + path;
    }
    var read_, readAsync, readBinary, setWindowTitle;
    if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
      if (ENVIRONMENT_IS_WORKER) {
        scriptDirectory = self.location.href;
      } else if (typeof document !== "undefined" && document.currentScript) {
        scriptDirectory = document.currentScript.src;
      }
      if (_scriptDir) {
        scriptDirectory = _scriptDir;
      }
      if (scriptDirectory.indexOf("blob:") !== 0) {
        scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf("/") + 1);
      } else {
        scriptDirectory = "";
      }
      if (!(typeof window === "object" || typeof importScripts === "function"))
        throw new Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
      {
        read_ = function(url) {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, false);
          xhr.send(null);
          return xhr.responseText;
        };
        if (ENVIRONMENT_IS_WORKER) {
          readBinary = function(url) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.responseType = "arraybuffer";
            xhr.send(null);
            return new Uint8Array(
              /** @type{!ArrayBuffer} */
              xhr.response
            );
          };
        }
        readAsync = function(url, onload, onerror) {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          xhr.onload = function() {
            if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
              onload(xhr.response);
              return;
            }
            onerror();
          };
          xhr.onerror = onerror;
          xhr.send(null);
        };
      }
      setWindowTitle = function(title) {
        document.title = title;
      };
    } else {
      throw new Error("environment detection error");
    }
    var out = Module2["print"] || console.log.bind(console);
    var err = Module2["printErr"] || console.warn.bind(console);
    for (key in moduleOverrides) {
      if (moduleOverrides.hasOwnProperty(key)) {
        Module2[key] = moduleOverrides[key];
      }
    }
    moduleOverrides = null;
    if (Module2["arguments"])
      arguments_ = Module2["arguments"];
    if (!Object.getOwnPropertyDescriptor(Module2, "arguments")) {
      Object.defineProperty(Module2, "arguments", {
        configurable: true,
        get: function() {
          abort("Module.arguments has been replaced with plain arguments_ (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    if (Module2["thisProgram"])
      thisProgram = Module2["thisProgram"];
    if (!Object.getOwnPropertyDescriptor(Module2, "thisProgram")) {
      Object.defineProperty(Module2, "thisProgram", {
        configurable: true,
        get: function() {
          abort("Module.thisProgram has been replaced with plain thisProgram (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    if (Module2["quit"])
      quit_ = Module2["quit"];
    if (!Object.getOwnPropertyDescriptor(Module2, "quit")) {
      Object.defineProperty(Module2, "quit", {
        configurable: true,
        get: function() {
          abort("Module.quit has been replaced with plain quit_ (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    assert(typeof Module2["memoryInitializerPrefixURL"] === "undefined", "Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead");
    assert(typeof Module2["pthreadMainPrefixURL"] === "undefined", "Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead");
    assert(typeof Module2["cdInitializerPrefixURL"] === "undefined", "Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead");
    assert(typeof Module2["filePackagePrefixURL"] === "undefined", "Module.filePackagePrefixURL option was removed, use Module.locateFile instead");
    assert(typeof Module2["read"] === "undefined", "Module.read option was removed (modify read_ in JS)");
    assert(typeof Module2["readAsync"] === "undefined", "Module.readAsync option was removed (modify readAsync in JS)");
    assert(typeof Module2["readBinary"] === "undefined", "Module.readBinary option was removed (modify readBinary in JS)");
    assert(typeof Module2["setWindowTitle"] === "undefined", "Module.setWindowTitle option was removed (modify setWindowTitle in JS)");
    assert(typeof Module2["TOTAL_MEMORY"] === "undefined", "Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY");
    if (!Object.getOwnPropertyDescriptor(Module2, "read")) {
      Object.defineProperty(Module2, "read", {
        configurable: true,
        get: function() {
          abort("Module.read has been replaced with plain read_ (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    if (!Object.getOwnPropertyDescriptor(Module2, "readAsync")) {
      Object.defineProperty(Module2, "readAsync", {
        configurable: true,
        get: function() {
          abort("Module.readAsync has been replaced with plain readAsync (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    if (!Object.getOwnPropertyDescriptor(Module2, "readBinary")) {
      Object.defineProperty(Module2, "readBinary", {
        configurable: true,
        get: function() {
          abort("Module.readBinary has been replaced with plain readBinary (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    if (!Object.getOwnPropertyDescriptor(Module2, "setWindowTitle")) {
      Object.defineProperty(Module2, "setWindowTitle", {
        configurable: true,
        get: function() {
          abort("Module.setWindowTitle has been replaced with plain setWindowTitle (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    var IDBFS = "IDBFS is no longer included by default; build with -lidbfs.js";
    var PROXYFS = "PROXYFS is no longer included by default; build with -lproxyfs.js";
    var WORKERFS = "WORKERFS is no longer included by default; build with -lworkerfs.js";
    var NODEFS = "NODEFS is no longer included by default; build with -lnodefs.js";
    var STACK_ALIGN = 16;
    function alignMemory(size, factor) {
      if (!factor)
        factor = STACK_ALIGN;
      return Math.ceil(size / factor) * factor;
    }
    function getNativeTypeSize(type) {
      switch (type) {
        case "i1":
        case "i8":
          return 1;
        case "i16":
          return 2;
        case "i32":
          return 4;
        case "i64":
          return 8;
        case "float":
          return 4;
        case "double":
          return 8;
        default: {
          if (type[type.length - 1] === "*") {
            return 4;
          } else if (type[0] === "i") {
            var bits = Number(type.substr(1));
            assert(bits % 8 === 0, "getNativeTypeSize invalid bits " + bits + ", type " + type);
            return bits / 8;
          } else {
            return 0;
          }
        }
      }
    }
    function warnOnce(text) {
      if (!warnOnce.shown)
        warnOnce.shown = {};
      if (!warnOnce.shown[text]) {
        warnOnce.shown[text] = 1;
        err(text);
      }
    }
    function convertJsFunctionToWasm(func, sig) {
      if (typeof WebAssembly.Function === "function") {
        var typeNames = {
          "i": "i32",
          "j": "i64",
          "f": "f32",
          "d": "f64"
        };
        var type = {
          parameters: [],
          results: sig[0] == "v" ? [] : [typeNames[sig[0]]]
        };
        for (var i = 1; i < sig.length; ++i) {
          type.parameters.push(typeNames[sig[i]]);
        }
        return new WebAssembly.Function(type, func);
      }
      var typeSection = [
        1,
        // id: section,
        0,
        // length: 0 (placeholder)
        1,
        // count: 1
        96
        // form: func
      ];
      var sigRet = sig.slice(0, 1);
      var sigParam = sig.slice(1);
      var typeCodes = {
        "i": 127,
        // i32
        "j": 126,
        // i64
        "f": 125,
        // f32
        "d": 124
        // f64
      };
      typeSection.push(sigParam.length);
      for (var i = 0; i < sigParam.length; ++i) {
        typeSection.push(typeCodes[sigParam[i]]);
      }
      if (sigRet == "v") {
        typeSection.push(0);
      } else {
        typeSection = typeSection.concat([1, typeCodes[sigRet]]);
      }
      typeSection[1] = typeSection.length - 2;
      var bytes = new Uint8Array([
        0,
        97,
        115,
        109,
        // magic ("\0asm")
        1,
        0,
        0,
        0
        // version: 1
      ].concat(typeSection, [
        2,
        7,
        // import section
        // (import "e" "f" (func 0 (type 0)))
        1,
        1,
        101,
        1,
        102,
        0,
        0,
        7,
        5,
        // export section
        // (export "f" (func 0 (type 0)))
        1,
        1,
        102,
        0,
        0
      ]));
      var module = new WebAssembly.Module(bytes);
      var instance = new WebAssembly.Instance(module, {
        "e": {
          "f": func
        }
      });
      var wrappedFunc = instance.exports["f"];
      return wrappedFunc;
    }
    var freeTableIndexes = [];
    var functionsInTableMap;
    function getEmptyTableSlot() {
      if (freeTableIndexes.length) {
        return freeTableIndexes.pop();
      }
      try {
        wasmTable.grow(1);
      } catch (err2) {
        if (!(err2 instanceof RangeError)) {
          throw err2;
        }
        throw "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.";
      }
      return wasmTable.length - 1;
    }
    function addFunctionWasm(func, sig) {
      if (!functionsInTableMap) {
        functionsInTableMap = /* @__PURE__ */ new WeakMap();
        for (var i = 0; i < wasmTable.length; i++) {
          var item = wasmTable.get(i);
          if (item) {
            functionsInTableMap.set(item, i);
          }
        }
      }
      if (functionsInTableMap.has(func)) {
        return functionsInTableMap.get(func);
      }
      var ret = getEmptyTableSlot();
      try {
        wasmTable.set(ret, func);
      } catch (err2) {
        if (!(err2 instanceof TypeError)) {
          throw err2;
        }
        assert(typeof sig !== "undefined", "Missing signature argument to addFunction: " + func);
        var wrapped = convertJsFunctionToWasm(func, sig);
        wasmTable.set(ret, wrapped);
      }
      functionsInTableMap.set(func, ret);
      return ret;
    }
    function removeFunction(index) {
      functionsInTableMap.delete(wasmTable.get(index));
      freeTableIndexes.push(index);
    }
    function addFunction(func, sig) {
      assert(typeof func !== "undefined");
      return addFunctionWasm(func, sig);
    }
    var tempRet0 = 0;
    var setTempRet0 = function(value) {
      tempRet0 = value;
    };
    var getTempRet0 = function() {
      return tempRet0;
    };
    var wasmBinary;
    if (Module2["wasmBinary"])
      wasmBinary = Module2["wasmBinary"];
    if (!Object.getOwnPropertyDescriptor(Module2, "wasmBinary")) {
      Object.defineProperty(Module2, "wasmBinary", {
        configurable: true,
        get: function() {
          abort("Module.wasmBinary has been replaced with plain wasmBinary (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    var noExitRuntime = Module2["noExitRuntime"] || true;
    if (!Object.getOwnPropertyDescriptor(Module2, "noExitRuntime")) {
      Object.defineProperty(Module2, "noExitRuntime", {
        configurable: true,
        get: function() {
          abort("Module.noExitRuntime has been replaced with plain noExitRuntime (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    if (typeof WebAssembly !== "object") {
      abort("no native wasm support detected");
    }
    function setValue(ptr, value, type, noSafe) {
      type = type || "i8";
      if (type.charAt(type.length - 1) === "*")
        type = "i32";
      switch (type) {
        case "i1":
          HEAP8[ptr >> 0] = value;
          break;
        case "i8":
          HEAP8[ptr >> 0] = value;
          break;
        case "i16":
          HEAP16[ptr >> 1] = value;
          break;
        case "i32":
          HEAP32[ptr >> 2] = value;
          break;
        case "i64":
          tempI64 = [value >>> 0, (tempDouble = value, +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? (Math.min(+Math.floor(tempDouble / 4294967296), 4294967295) | 0) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[ptr >> 2] = tempI64[0], HEAP32[ptr + 4 >> 2] = tempI64[1];
          break;
        case "float":
          HEAPF32[ptr >> 2] = value;
          break;
        case "double":
          HEAPF64[ptr >> 3] = value;
          break;
        default:
          abort("invalid type for setValue: " + type);
      }
    }
    function getValue(ptr, type, noSafe) {
      type = type || "i8";
      if (type.charAt(type.length - 1) === "*")
        type = "i32";
      switch (type) {
        case "i1":
          return HEAP8[ptr >> 0];
        case "i8":
          return HEAP8[ptr >> 0];
        case "i16":
          return HEAP16[ptr >> 1];
        case "i32":
          return HEAP32[ptr >> 2];
        case "i64":
          return HEAP32[ptr >> 2];
        case "float":
          return HEAPF32[ptr >> 2];
        case "double":
          return HEAPF64[ptr >> 3];
        default:
          abort("invalid type for getValue: " + type);
      }
      return null;
    }
    var wasmMemory;
    var ABORT = false;
    var EXITSTATUS;
    function assert(condition, text) {
      if (!condition) {
        abort("Assertion failed: " + text);
      }
    }
    function getCFunc(ident) {
      var func = Module2["_" + ident];
      assert(func, "Cannot call unknown function " + ident + ", make sure it is exported");
      return func;
    }
    function ccall(ident, returnType, argTypes, args, opts) {
      var toC = {
        "string": function(str6) {
          var ret2 = 0;
          if (str6 !== null && str6 !== void 0 && str6 !== 0) {
            var len4 = (str6.length << 2) + 1;
            ret2 = stackAlloc(len4);
            stringToUTF8(str6, ret2, len4);
          }
          return ret2;
        },
        "array": function(arr) {
          var ret2 = stackAlloc(arr.length);
          writeArrayToMemory(arr, ret2);
          return ret2;
        }
      };
      function convertReturnValue(ret2) {
        if (returnType === "string")
          return UTF8ToString(ret2);
        if (returnType === "boolean")
          return Boolean(ret2);
        return ret2;
      }
      var func = getCFunc(ident);
      var cArgs = [];
      var stack = 0;
      assert(returnType !== "array", 'Return type should not be "array".');
      if (args) {
        for (var i = 0; i < args.length; i++) {
          var converter = toC[argTypes[i]];
          if (converter) {
            if (stack === 0)
              stack = stackSave();
            cArgs[i] = converter(args[i]);
          } else {
            cArgs[i] = args[i];
          }
        }
      }
      var ret = func.apply(null, cArgs);
      ret = convertReturnValue(ret);
      if (stack !== 0)
        stackRestore(stack);
      return ret;
    }
    function cwrap(ident, returnType, argTypes, opts) {
      return function() {
        return ccall(ident, returnType, argTypes, arguments, opts);
      };
    }
    var ALLOC_NORMAL = 0;
    var ALLOC_STACK = 1;
    function allocate(slab, allocator) {
      var ret;
      assert(typeof allocator === "number", "allocate no longer takes a type argument");
      assert(typeof slab !== "number", "allocate no longer takes a number as arg0");
      if (allocator == ALLOC_STACK) {
        ret = stackAlloc(slab.length);
      } else {
        ret = _malloc(slab.length);
      }
      if (slab.subarray || slab.slice) {
        HEAPU8.set(
          /** @type {!Uint8Array} */
          slab,
          ret
        );
      } else {
        HEAPU8.set(new Uint8Array(slab), ret);
      }
      return ret;
    }
    var UTF8Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf8") : void 0;
    function UTF8ArrayToString(heap, idx, maxBytesToRead) {
      var endIdx = idx + maxBytesToRead;
      var endPtr = idx;
      while (heap[endPtr] && !(endPtr >= endIdx))
        ++endPtr;
      if (endPtr - idx > 16 && heap.subarray && UTF8Decoder) {
        return UTF8Decoder.decode(heap.subarray(idx, endPtr));
      } else {
        var str6 = "";
        while (idx < endPtr) {
          var u0 = heap[idx++];
          if (!(u0 & 128)) {
            str6 += String.fromCharCode(u0);
            continue;
          }
          var u1 = heap[idx++] & 63;
          if ((u0 & 224) == 192) {
            str6 += String.fromCharCode((u0 & 31) << 6 | u1);
            continue;
          }
          var u2 = heap[idx++] & 63;
          if ((u0 & 240) == 224) {
            u0 = (u0 & 15) << 12 | u1 << 6 | u2;
          } else {
            if ((u0 & 248) != 240)
              warnOnce("Invalid UTF-8 leading byte 0x" + u0.toString(16) + " encountered when deserializing a UTF-8 string in wasm memory to a JS string!");
            u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heap[idx++] & 63;
          }
          if (u0 < 65536) {
            str6 += String.fromCharCode(u0);
          } else {
            var ch = u0 - 65536;
            str6 += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
          }
        }
      }
      return str6;
    }
    function UTF8ToString(ptr, maxBytesToRead) {
      return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
    }
    function stringToUTF8Array(str6, heap, outIdx, maxBytesToWrite) {
      if (!(maxBytesToWrite > 0))
        return 0;
      var startIdx = outIdx;
      var endIdx = outIdx + maxBytesToWrite - 1;
      for (var i = 0; i < str6.length; ++i) {
        var u = str6.charCodeAt(i);
        if (u >= 55296 && u <= 57343) {
          var u1 = str6.charCodeAt(++i);
          u = 65536 + ((u & 1023) << 10) | u1 & 1023;
        }
        if (u <= 127) {
          if (outIdx >= endIdx)
            break;
          heap[outIdx++] = u;
        } else if (u <= 2047) {
          if (outIdx + 1 >= endIdx)
            break;
          heap[outIdx++] = 192 | u >> 6;
          heap[outIdx++] = 128 | u & 63;
        } else if (u <= 65535) {
          if (outIdx + 2 >= endIdx)
            break;
          heap[outIdx++] = 224 | u >> 12;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        } else {
          if (outIdx + 3 >= endIdx)
            break;
          if (u >= 2097152)
            warnOnce("Invalid Unicode code point 0x" + u.toString(16) + " encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x1FFFFF).");
          heap[outIdx++] = 240 | u >> 18;
          heap[outIdx++] = 128 | u >> 12 & 63;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        }
      }
      heap[outIdx] = 0;
      return outIdx - startIdx;
    }
    function stringToUTF8(str6, outPtr, maxBytesToWrite) {
      assert(typeof maxBytesToWrite == "number", "stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!");
      return stringToUTF8Array(str6, HEAPU8, outPtr, maxBytesToWrite);
    }
    function lengthBytesUTF8(str6) {
      var len4 = 0;
      for (var i = 0; i < str6.length; ++i) {
        var u = str6.charCodeAt(i);
        if (u >= 55296 && u <= 57343)
          u = 65536 + ((u & 1023) << 10) | str6.charCodeAt(++i) & 1023;
        if (u <= 127)
          ++len4;
        else if (u <= 2047)
          len4 += 2;
        else if (u <= 65535)
          len4 += 3;
        else
          len4 += 4;
      }
      return len4;
    }
    function AsciiToString(ptr) {
      var str6 = "";
      while (1) {
        var ch = HEAPU8[ptr++ >> 0];
        if (!ch)
          return str6;
        str6 += String.fromCharCode(ch);
      }
    }
    function stringToAscii(str6, outPtr) {
      return writeAsciiToMemory(str6, outPtr, false);
    }
    var UTF16Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-16le") : void 0;
    function UTF16ToString(ptr, maxBytesToRead) {
      assert(ptr % 2 == 0, "Pointer passed to UTF16ToString must be aligned to two bytes!");
      var endPtr = ptr;
      var idx = endPtr >> 1;
      var maxIdx = idx + maxBytesToRead / 2;
      while (!(idx >= maxIdx) && HEAPU16[idx])
        ++idx;
      endPtr = idx << 1;
      if (endPtr - ptr > 32 && UTF16Decoder) {
        return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
      } else {
        var str6 = "";
        for (var i = 0; !(i >= maxBytesToRead / 2); ++i) {
          var codeUnit = HEAP16[ptr + i * 2 >> 1];
          if (codeUnit == 0)
            break;
          str6 += String.fromCharCode(codeUnit);
        }
        return str6;
      }
    }
    function stringToUTF16(str6, outPtr, maxBytesToWrite) {
      assert(outPtr % 2 == 0, "Pointer passed to stringToUTF16 must be aligned to two bytes!");
      assert(typeof maxBytesToWrite == "number", "stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!");
      if (maxBytesToWrite === void 0) {
        maxBytesToWrite = 2147483647;
      }
      if (maxBytesToWrite < 2)
        return 0;
      maxBytesToWrite -= 2;
      var startPtr = outPtr;
      var numCharsToWrite = maxBytesToWrite < str6.length * 2 ? maxBytesToWrite / 2 : str6.length;
      for (var i = 0; i < numCharsToWrite; ++i) {
        var codeUnit = str6.charCodeAt(i);
        HEAP16[outPtr >> 1] = codeUnit;
        outPtr += 2;
      }
      HEAP16[outPtr >> 1] = 0;
      return outPtr - startPtr;
    }
    function lengthBytesUTF16(str6) {
      return str6.length * 2;
    }
    function UTF32ToString(ptr, maxBytesToRead) {
      assert(ptr % 4 == 0, "Pointer passed to UTF32ToString must be aligned to four bytes!");
      var i = 0;
      var str6 = "";
      while (!(i >= maxBytesToRead / 4)) {
        var utf32 = HEAP32[ptr + i * 4 >> 2];
        if (utf32 == 0)
          break;
        ++i;
        if (utf32 >= 65536) {
          var ch = utf32 - 65536;
          str6 += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
        } else {
          str6 += String.fromCharCode(utf32);
        }
      }
      return str6;
    }
    function stringToUTF32(str6, outPtr, maxBytesToWrite) {
      assert(outPtr % 4 == 0, "Pointer passed to stringToUTF32 must be aligned to four bytes!");
      assert(typeof maxBytesToWrite == "number", "stringToUTF32(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!");
      if (maxBytesToWrite === void 0) {
        maxBytesToWrite = 2147483647;
      }
      if (maxBytesToWrite < 4)
        return 0;
      var startPtr = outPtr;
      var endPtr = startPtr + maxBytesToWrite - 4;
      for (var i = 0; i < str6.length; ++i) {
        var codeUnit = str6.charCodeAt(i);
        if (codeUnit >= 55296 && codeUnit <= 57343) {
          var trailSurrogate = str6.charCodeAt(++i);
          codeUnit = 65536 + ((codeUnit & 1023) << 10) | trailSurrogate & 1023;
        }
        HEAP32[outPtr >> 2] = codeUnit;
        outPtr += 4;
        if (outPtr + 4 > endPtr)
          break;
      }
      HEAP32[outPtr >> 2] = 0;
      return outPtr - startPtr;
    }
    function lengthBytesUTF32(str6) {
      var len4 = 0;
      for (var i = 0; i < str6.length; ++i) {
        var codeUnit = str6.charCodeAt(i);
        if (codeUnit >= 55296 && codeUnit <= 57343)
          ++i;
        len4 += 4;
      }
      return len4;
    }
    function allocateUTF8(str6) {
      var size = lengthBytesUTF8(str6) + 1;
      var ret = _malloc(size);
      if (ret)
        stringToUTF8Array(str6, HEAP8, ret, size);
      return ret;
    }
    function allocateUTF8OnStack(str6) {
      var size = lengthBytesUTF8(str6) + 1;
      var ret = stackAlloc(size);
      stringToUTF8Array(str6, HEAP8, ret, size);
      return ret;
    }
    function writeStringToMemory(string, buffer2, dontAddNull) {
      warnOnce("writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!");
      var lastChar, end;
      if (dontAddNull) {
        end = buffer2 + lengthBytesUTF8(string);
        lastChar = HEAP8[end];
      }
      stringToUTF8(string, buffer2, Infinity);
      if (dontAddNull)
        HEAP8[end] = lastChar;
    }
    function writeArrayToMemory(array, buffer2) {
      assert(array.length >= 0, "writeArrayToMemory array must have a length (should be an array or typed array)");
      HEAP8.set(array, buffer2);
    }
    function writeAsciiToMemory(str6, buffer2, dontAddNull) {
      for (var i = 0; i < str6.length; ++i) {
        assert(str6.charCodeAt(i) === str6.charCodeAt(i) & 255);
        HEAP8[buffer2++ >> 0] = str6.charCodeAt(i);
      }
      if (!dontAddNull)
        HEAP8[buffer2 >> 0] = 0;
    }
    function alignUp(x, multiple) {
      if (x % multiple > 0) {
        x += multiple - x % multiple;
      }
      return x;
    }
    var HEAP, buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
    function updateGlobalBufferAndViews(buf) {
      buffer = buf;
      Module2["HEAP8"] = HEAP8 = new Int8Array(buf);
      Module2["HEAP16"] = HEAP16 = new Int16Array(buf);
      Module2["HEAP32"] = HEAP32 = new Int32Array(buf);
      Module2["HEAPU8"] = HEAPU8 = new Uint8Array(buf);
      Module2["HEAPU16"] = HEAPU16 = new Uint16Array(buf);
      Module2["HEAPU32"] = HEAPU32 = new Uint32Array(buf);
      Module2["HEAPF32"] = HEAPF32 = new Float32Array(buf);
      Module2["HEAPF64"] = HEAPF64 = new Float64Array(buf);
    }
    var TOTAL_STACK = 5242880;
    if (Module2["TOTAL_STACK"])
      assert(TOTAL_STACK === Module2["TOTAL_STACK"], "the stack size can no longer be determined at runtime");
    var INITIAL_MEMORY = Module2["INITIAL_MEMORY"] || 16777216;
    if (!Object.getOwnPropertyDescriptor(Module2, "INITIAL_MEMORY")) {
      Object.defineProperty(Module2, "INITIAL_MEMORY", {
        configurable: true,
        get: function() {
          abort("Module.INITIAL_MEMORY has been replaced with plain INITIAL_MEMORY (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
        }
      });
    }
    assert(INITIAL_MEMORY >= TOTAL_STACK, "INITIAL_MEMORY should be larger than TOTAL_STACK, was " + INITIAL_MEMORY + "! (TOTAL_STACK=" + TOTAL_STACK + ")");
    assert(
      typeof Int32Array !== "undefined" && typeof Float64Array !== "undefined" && Int32Array.prototype.subarray !== void 0 && Int32Array.prototype.set !== void 0,
      "JS engine does not provide full typed array support"
    );
    assert(!Module2["wasmMemory"], "Use of `wasmMemory` detected.  Use -s IMPORTED_MEMORY to define wasmMemory externally");
    assert(INITIAL_MEMORY == 16777216, "Detected runtime INITIAL_MEMORY setting.  Use -s IMPORTED_MEMORY to define wasmMemory dynamically");
    var wasmTable;
    function writeStackCookie() {
      var max4 = _emscripten_stack_get_end();
      assert((max4 & 3) == 0);
      HEAPU32[(max4 >> 2) + 1] = 34821223;
      HEAPU32[(max4 >> 2) + 2] = 2310721022;
      HEAP32[0] = 1668509029;
    }
    function checkStackCookie() {
      if (ABORT)
        return;
      var max4 = _emscripten_stack_get_end();
      var cookie1 = HEAPU32[(max4 >> 2) + 1];
      var cookie2 = HEAPU32[(max4 >> 2) + 2];
      if (cookie1 != 34821223 || cookie2 != 2310721022) {
        abort("Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x2135467, but received 0x" + cookie2.toString(16) + " " + cookie1.toString(16));
      }
      if (HEAP32[0] !== 1668509029)
        abort("Runtime error: The application has corrupted its heap memory area (address zero)!");
    }
    (function() {
      var h16 = new Int16Array(1);
      var h8 = new Int8Array(h16.buffer);
      h16[0] = 25459;
      if (h8[0] !== 115 || h8[1] !== 99)
        throw "Runtime error: expected the system to be little-endian! (Run with -s SUPPORT_BIG_ENDIAN=1 to bypass)";
    })();
    var __ATPRERUN__ = [];
    var __ATINIT__ = [];
    var __ATMAIN__ = [];
    var __ATEXIT__ = [];
    var __ATPOSTRUN__ = [];
    var runtimeInitialized = false;
    var runtimeExited = false;
    function preRun() {
      if (Module2["preRun"]) {
        if (typeof Module2["preRun"] == "function")
          Module2["preRun"] = [Module2["preRun"]];
        while (Module2["preRun"].length) {
          addOnPreRun(Module2["preRun"].shift());
        }
      }
      callRuntimeCallbacks(__ATPRERUN__);
    }
    function initRuntime() {
      checkStackCookie();
      assert(!runtimeInitialized);
      runtimeInitialized = true;
      callRuntimeCallbacks(__ATINIT__);
    }
    function exitRuntime() {
      checkStackCookie();
      runtimeExited = true;
    }
    function postRun() {
      checkStackCookie();
      if (Module2["postRun"]) {
        if (typeof Module2["postRun"] == "function")
          Module2["postRun"] = [Module2["postRun"]];
        while (Module2["postRun"].length) {
          addOnPostRun(Module2["postRun"].shift());
        }
      }
      callRuntimeCallbacks(__ATPOSTRUN__);
    }
    function addOnPreRun(cb) {
      __ATPRERUN__.unshift(cb);
    }
    function addOnInit(cb) {
      __ATINIT__.unshift(cb);
    }
    function addOnPreMain(cb) {
      __ATMAIN__.unshift(cb);
    }
    function addOnExit(cb) {
    }
    function addOnPostRun(cb) {
      __ATPOSTRUN__.unshift(cb);
    }
    assert(Math.imul, "This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
    assert(Math.fround, "This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
    assert(Math.clz32, "This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
    assert(Math.trunc, "This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
    var runDependencies = 0;
    var runDependencyWatcher = null;
    var dependenciesFulfilled = null;
    var runDependencyTracking = {};
    function getUniqueRunDependency(id) {
      var orig = id;
      while (1) {
        if (!runDependencyTracking[id])
          return id;
        id = orig + Math.random();
      }
    }
    function addRunDependency(id) {
      runDependencies++;
      if (Module2["monitorRunDependencies"]) {
        Module2["monitorRunDependencies"](runDependencies);
      }
      if (id) {
        assert(!runDependencyTracking[id]);
        runDependencyTracking[id] = 1;
        if (runDependencyWatcher === null && typeof setInterval !== "undefined") {
          runDependencyWatcher = setInterval(function() {
            if (ABORT) {
              clearInterval(runDependencyWatcher);
              runDependencyWatcher = null;
              return;
            }
            var shown = false;
            for (var dep in runDependencyTracking) {
              if (!shown) {
                shown = true;
                err("still waiting on run dependencies:");
              }
              err("dependency: " + dep);
            }
            if (shown) {
              err("(end of list)");
            }
          }, 1e4);
        }
      } else {
        err("warning: run dependency added without ID");
      }
    }
    function removeRunDependency(id) {
      runDependencies--;
      if (Module2["monitorRunDependencies"]) {
        Module2["monitorRunDependencies"](runDependencies);
      }
      if (id) {
        assert(runDependencyTracking[id]);
        delete runDependencyTracking[id];
      } else {
        err("warning: run dependency removed without ID");
      }
      if (runDependencies == 0) {
        if (runDependencyWatcher !== null) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
        }
        if (dependenciesFulfilled) {
          var callback = dependenciesFulfilled;
          dependenciesFulfilled = null;
          callback();
        }
      }
    }
    Module2["preloadedImages"] = {};
    Module2["preloadedAudios"] = {};
    function abort(what) {
      if (Module2["onAbort"]) {
        Module2["onAbort"](what);
      }
      what += "";
      err(what);
      ABORT = true;
      EXITSTATUS = 1;
      var output = "abort(" + what + ") at " + stackTrace();
      what = output;
      var e = new WebAssembly.RuntimeError(what);
      readyPromiseReject(e);
      throw e;
    }
    var FS = {
      error: function() {
        abort("Filesystem support (FS) was not included. The problem is that you are using files from JS, but files were not used from C/C++, so filesystem support was not auto-included. You can force-include filesystem support with  -s FORCE_FILESYSTEM=1");
      },
      init: function() {
        FS.error();
      },
      createDataFile: function() {
        FS.error();
      },
      createPreloadedFile: function() {
        FS.error();
      },
      createLazyFile: function() {
        FS.error();
      },
      open: function() {
        FS.error();
      },
      mkdev: function() {
        FS.error();
      },
      registerDevice: function() {
        FS.error();
      },
      analyzePath: function() {
        FS.error();
      },
      loadFilesFromDB: function() {
        FS.error();
      },
      ErrnoError: function ErrnoError() {
        FS.error();
      }
    };
    Module2["FS_createDataFile"] = FS.createDataFile;
    Module2["FS_createPreloadedFile"] = FS.createPreloadedFile;
    var dataURIPrefix = "data:application/octet-stream;base64,";
    function isDataURI(filename) {
      return filename.startsWith(dataURIPrefix);
    }
    function isFileURI(filename) {
      return filename.startsWith("file://");
    }
    function createExportWrapper(name, fixedasm) {
      return function() {
        var displayName = name;
        var asm2 = fixedasm;
        if (!fixedasm) {
          asm2 = Module2["asm"];
        }
        assert(runtimeInitialized, "native function `" + displayName + "` called before runtime initialization");
        assert(!runtimeExited, "native function `" + displayName + "` called after runtime exit (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
        if (!asm2[name]) {
          assert(asm2[name], "exported native function `" + displayName + "` not found");
        }
        return asm2[name].apply(null, arguments);
      };
    }
    var wasmBinaryFile;
    wasmBinaryFile = "nurbs.wasm";
    if (!isDataURI(wasmBinaryFile)) {
      wasmBinaryFile = locateFile(wasmBinaryFile);
    }
    function getBinary(file) {
      try {
        if (file == wasmBinaryFile && wasmBinary) {
          return new Uint8Array(wasmBinary);
        }
        if (readBinary) {
          return readBinary(file);
        } else {
          throw "both async and sync fetching of the wasm failed";
        }
      } catch (err2) {
        abort(err2);
      }
    }
    function getBinaryPromise() {
      if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
        if (typeof fetch === "function") {
          return fetch(wasmBinaryFile, { credentials: "same-origin" }).then(function(response) {
            if (!response["ok"]) {
              throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
            }
            return response["arrayBuffer"]();
          }).catch(function() {
            return getBinary(wasmBinaryFile);
          });
        }
      }
      return Promise.resolve().then(function() {
        return getBinary(wasmBinaryFile);
      });
    }
    function createWasm() {
      var info = {
        "env": asmLibraryArg,
        "wasi_snapshot_preview1": asmLibraryArg
      };
      function receiveInstance(instance, module) {
        var exports2 = instance.exports;
        Module2["asm"] = exports2;
        wasmMemory = Module2["asm"]["memory"];
        assert(wasmMemory, "memory not found in wasm exports");
        updateGlobalBufferAndViews(wasmMemory.buffer);
        wasmTable = Module2["asm"]["__indirect_function_table"];
        assert(wasmTable, "table not found in wasm exports");
        addOnInit(Module2["asm"]["__wasm_call_ctors"]);
        removeRunDependency("wasm-instantiate");
      }
      addRunDependency("wasm-instantiate");
      var trueModule = Module2;
      function receiveInstantiationResult(result) {
        assert(Module2 === trueModule, "the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?");
        trueModule = null;
        receiveInstance(result["instance"]);
      }
      function instantiateArrayBuffer(receiver) {
        return getBinaryPromise().then(function(binary) {
          var result = WebAssembly.instantiate(binary, info);
          return result;
        }).then(receiver, function(reason) {
          err("failed to asynchronously prepare wasm: " + reason);
          if (isFileURI(wasmBinaryFile)) {
            err("warning: Loading from a file URI (" + wasmBinaryFile + ") is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing");
          }
          abort(reason);
        });
      }
      function instantiateAsync() {
        if (!wasmBinary && typeof WebAssembly.instantiateStreaming === "function" && !isDataURI(wasmBinaryFile) && typeof fetch === "function") {
          return fetch(wasmBinaryFile, { credentials: "same-origin" }).then(function(response) {
            var result = WebAssembly.instantiateStreaming(response, info);
            return result.then(receiveInstantiationResult, function(reason) {
              err("wasm streaming compile failed: " + reason);
              err("falling back to ArrayBuffer instantiation");
              return instantiateArrayBuffer(receiveInstantiationResult);
            });
          });
        } else {
          return instantiateArrayBuffer(receiveInstantiationResult);
        }
      }
      if (Module2["instantiateWasm"]) {
        try {
          var exports = Module2["instantiateWasm"](info, receiveInstance);
          return exports;
        } catch (e) {
          err("Module.instantiateWasm callback failed with error: " + e);
          return false;
        }
      }
      instantiateAsync().catch(readyPromiseReject);
      return {};
    }
    var tempDouble;
    var tempI64;
    var ASM_CONSTS = {};
    function callRuntimeCallbacks(callbacks) {
      while (callbacks.length > 0) {
        var callback = callbacks.shift();
        if (typeof callback == "function") {
          callback(Module2);
          continue;
        }
        var func = callback.func;
        if (typeof func === "number") {
          if (callback.arg === void 0) {
            wasmTable.get(func)();
          } else {
            wasmTable.get(func)(callback.arg);
          }
        } else {
          func(callback.arg === void 0 ? null : callback.arg);
        }
      }
    }
    function demangle(func) {
      warnOnce("warning: build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling");
      return func;
    }
    function demangleAll(text) {
      var regex = /\b_Z[\w\d_]+/g;
      return text.replace(
        regex,
        function(x) {
          var y = demangle(x);
          return x === y ? x : y + " [" + x + "]";
        }
      );
    }
    function jsStackTrace() {
      var error = new Error();
      if (!error.stack) {
        try {
          throw new Error();
        } catch (e) {
          error = e;
        }
        if (!error.stack) {
          return "(no stack trace available)";
        }
      }
      return error.stack.toString();
    }
    var runtimeKeepaliveCounter = 0;
    function keepRuntimeAlive() {
      return noExitRuntime || runtimeKeepaliveCounter > 0;
    }
    function stackTrace() {
      var js = jsStackTrace();
      if (Module2["extraStackTrace"])
        js += "\n" + Module2["extraStackTrace"]();
      return demangleAll(js);
    }
    function ___assert_fail(condition, filename, line, func) {
      abort("Assertion failed: " + UTF8ToString(condition) + ", at: " + [filename ? UTF8ToString(filename) : "unknown filename", line, func ? UTF8ToString(func) : "unknown function"]);
    }
    var ExceptionInfoAttrs = { DESTRUCTOR_OFFSET: 0, REFCOUNT_OFFSET: 4, TYPE_OFFSET: 8, CAUGHT_OFFSET: 12, RETHROWN_OFFSET: 13, SIZE: 16 };
    function ___cxa_allocate_exception(size) {
      return _malloc(size + ExceptionInfoAttrs.SIZE) + ExceptionInfoAttrs.SIZE;
    }
    function ExceptionInfo(excPtr) {
      this.excPtr = excPtr;
      this.ptr = excPtr - ExceptionInfoAttrs.SIZE;
      this.set_type = function(type) {
        HEAP32[this.ptr + ExceptionInfoAttrs.TYPE_OFFSET >> 2] = type;
      };
      this.get_type = function() {
        return HEAP32[this.ptr + ExceptionInfoAttrs.TYPE_OFFSET >> 2];
      };
      this.set_destructor = function(destructor) {
        HEAP32[this.ptr + ExceptionInfoAttrs.DESTRUCTOR_OFFSET >> 2] = destructor;
      };
      this.get_destructor = function() {
        return HEAP32[this.ptr + ExceptionInfoAttrs.DESTRUCTOR_OFFSET >> 2];
      };
      this.set_refcount = function(refcount) {
        HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2] = refcount;
      };
      this.set_caught = function(caught) {
        caught = caught ? 1 : 0;
        HEAP8[this.ptr + ExceptionInfoAttrs.CAUGHT_OFFSET >> 0] = caught;
      };
      this.get_caught = function() {
        return HEAP8[this.ptr + ExceptionInfoAttrs.CAUGHT_OFFSET >> 0] != 0;
      };
      this.set_rethrown = function(rethrown) {
        rethrown = rethrown ? 1 : 0;
        HEAP8[this.ptr + ExceptionInfoAttrs.RETHROWN_OFFSET >> 0] = rethrown;
      };
      this.get_rethrown = function() {
        return HEAP8[this.ptr + ExceptionInfoAttrs.RETHROWN_OFFSET >> 0] != 0;
      };
      this.init = function(type, destructor) {
        this.set_type(type);
        this.set_destructor(destructor);
        this.set_refcount(0);
        this.set_caught(false);
        this.set_rethrown(false);
      };
      this.add_ref = function() {
        var value = HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2];
        HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2] = value + 1;
      };
      this.release_ref = function() {
        var prev = HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2];
        HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2] = prev - 1;
        assert(prev > 0);
        return prev === 1;
      };
    }
    var exceptionLast = 0;
    var uncaughtExceptionCount = 0;
    function ___cxa_throw(ptr, type, destructor) {
      var info = new ExceptionInfo(ptr);
      info.init(type, destructor);
      exceptionLast = ptr;
      uncaughtExceptionCount++;
      throw ptr + " - Exception catching is disabled, this exception cannot be caught. Compile with -s NO_DISABLE_EXCEPTION_CATCHING or -s EXCEPTION_CATCHING_ALLOWED=[..] to catch.";
    }
    function _abort() {
      abort();
    }
    function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.copyWithin(dest, src, src + num);
    }
    function abortOnCannotGrowMemory(requestedSize) {
      abort("Cannot enlarge memory arrays to size " + requestedSize + " bytes (OOM). Either (1) compile with  -s INITIAL_MEMORY=X  with X higher than the current value " + HEAP8.length + ", (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ");
    }
    function _emscripten_resize_heap(requestedSize) {
      var oldSize = HEAPU8.length;
      requestedSize = requestedSize >>> 0;
      abortOnCannotGrowMemory(requestedSize);
    }
    var ASSERTIONS = true;
    function intArrayFromString(stringy, dontAddNull, length4) {
      var len4 = length4 > 0 ? length4 : lengthBytesUTF8(stringy) + 1;
      var u8array = new Array(len4);
      var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
      if (dontAddNull)
        u8array.length = numBytesWritten;
      return u8array;
    }
    function intArrayToString(array) {
      var ret = [];
      for (var i = 0; i < array.length; i++) {
        var chr = array[i];
        if (chr > 255) {
          if (ASSERTIONS) {
            assert(false, "Character code " + chr + " (" + String.fromCharCode(chr) + ")  at offset " + i + " not in 0x00-0xFF.");
          }
          chr &= 255;
        }
        ret.push(String.fromCharCode(chr));
      }
      return ret.join("");
    }
    var asmLibraryArg = {
      "__assert_fail": ___assert_fail,
      "__cxa_allocate_exception": ___cxa_allocate_exception,
      "__cxa_throw": ___cxa_throw,
      "abort": _abort,
      "emscripten_memcpy_big": _emscripten_memcpy_big,
      "emscripten_resize_heap": _emscripten_resize_heap
    };
    var asm = createWasm();
    var ___wasm_call_ctors = Module2["___wasm_call_ctors"] = createExportWrapper("__wasm_call_ctors");
    var _getNurbsCurve2D = Module2["_getNurbsCurve2D"] = createExportWrapper("getNurbsCurve2D");
    var _getNurbsCurve2DWithWeights = Module2["_getNurbsCurve2DWithWeights"] = createExportWrapper("getNurbsCurve2DWithWeights");
    var _evalNurbsCurve2D = Module2["_evalNurbsCurve2D"] = createExportWrapper("evalNurbsCurve2D");
    var _evalNurbsCurve2DWithWeights = Module2["_evalNurbsCurve2DWithWeights"] = createExportWrapper("evalNurbsCurve2DWithWeights");
    var _projectNurbsCurve2D = Module2["_projectNurbsCurve2D"] = createExportWrapper("projectNurbsCurve2D");
    var _disposeNurbsCurve2D = Module2["_disposeNurbsCurve2D"] = createExportWrapper("disposeNurbsCurve2D");
    var _disposeNurbsCurve2DWithWeights = Module2["_disposeNurbsCurve2DWithWeights"] = createExportWrapper("disposeNurbsCurve2DWithWeights");
    var _getNurbsCurve3D = Module2["_getNurbsCurve3D"] = createExportWrapper("getNurbsCurve3D");
    var _getNurbsCurve3DWithWeights = Module2["_getNurbsCurve3DWithWeights"] = createExportWrapper("getNurbsCurve3DWithWeights");
    var _evalNurbsCurve3D = Module2["_evalNurbsCurve3D"] = createExportWrapper("evalNurbsCurve3D");
    var _invertNurbsCurve3D = Module2["_invertNurbsCurve3D"] = createExportWrapper("invertNurbsCurve3D");
    var _evalNurbsCurve3DWithWeights = Module2["_evalNurbsCurve3DWithWeights"] = createExportWrapper("evalNurbsCurve3DWithWeights");
    var _evalNurbsCurve3dBulk = Module2["_evalNurbsCurve3dBulk"] = createExportWrapper("evalNurbsCurve3dBulk");
    var _disposeNurbsCurve3D = Module2["_disposeNurbsCurve3D"] = createExportWrapper("disposeNurbsCurve3D");
    var _disposeNurbsCurve3DWithWeights = Module2["_disposeNurbsCurve3DWithWeights"] = createExportWrapper("disposeNurbsCurve3DWithWeights");
    var _getNurbsSurface = Module2["_getNurbsSurface"] = createExportWrapper("getNurbsSurface");
    var _getNurbsSurfaceWithWeights = Module2["_getNurbsSurfaceWithWeights"] = createExportWrapper("getNurbsSurfaceWithWeights");
    var _evalNurbsSurface = Module2["_evalNurbsSurface"] = createExportWrapper("evalNurbsSurface");
    var _evalNurbsSurfaceBulk = Module2["_evalNurbsSurfaceBulk"] = createExportWrapper("evalNurbsSurfaceBulk");
    var _invertSurface = Module2["_invertSurface"] = createExportWrapper("invertSurface");
    var __Z19disposeNurbsSurfacePN10novo_nurbs7SurfaceIdEE = Module2["__Z19disposeNurbsSurfacePN10novo_nurbs7SurfaceIdEE"] = createExportWrapper("_Z19disposeNurbsSurfacePN10novo_nurbs7SurfaceIdEE");
    var __Z30disposeNurbsSurfaceWithWeightsPN10novo_nurbs15RationalSurfaceIdEE = Module2["__Z30disposeNurbsSurfaceWithWeightsPN10novo_nurbs15RationalSurfaceIdEE"] = createExportWrapper("_Z30disposeNurbsSurfaceWithWeightsPN10novo_nurbs15RationalSurfaceIdEE");
    var ___errno_location = Module2["___errno_location"] = createExportWrapper("__errno_location");
    var _fflush = Module2["_fflush"] = createExportWrapper("fflush");
    var stackSave = Module2["stackSave"] = createExportWrapper("stackSave");
    var stackRestore = Module2["stackRestore"] = createExportWrapper("stackRestore");
    var stackAlloc = Module2["stackAlloc"] = createExportWrapper("stackAlloc");
    var _emscripten_stack_init = Module2["_emscripten_stack_init"] = function() {
      return (_emscripten_stack_init = Module2["_emscripten_stack_init"] = Module2["asm"]["emscripten_stack_init"]).apply(null, arguments);
    };
    var _emscripten_stack_get_free = Module2["_emscripten_stack_get_free"] = function() {
      return (_emscripten_stack_get_free = Module2["_emscripten_stack_get_free"] = Module2["asm"]["emscripten_stack_get_free"]).apply(null, arguments);
    };
    var _emscripten_stack_get_end = Module2["_emscripten_stack_get_end"] = function() {
      return (_emscripten_stack_get_end = Module2["_emscripten_stack_get_end"] = Module2["asm"]["emscripten_stack_get_end"]).apply(null, arguments);
    };
    var _malloc = Module2["_malloc"] = createExportWrapper("malloc");
    var _free = Module2["_free"] = createExportWrapper("free");
    if (!Object.getOwnPropertyDescriptor(Module2, "intArrayFromString"))
      Module2["intArrayFromString"] = function() {
        abort("'intArrayFromString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "intArrayToString"))
      Module2["intArrayToString"] = function() {
        abort("'intArrayToString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "ccall"))
      Module2["ccall"] = function() {
        abort("'ccall' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "cwrap"))
      Module2["cwrap"] = function() {
        abort("'cwrap' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "setValue"))
      Module2["setValue"] = function() {
        abort("'setValue' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getValue"))
      Module2["getValue"] = function() {
        abort("'getValue' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "allocate"))
      Module2["allocate"] = function() {
        abort("'allocate' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "UTF8ArrayToString"))
      Module2["UTF8ArrayToString"] = function() {
        abort("'UTF8ArrayToString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "UTF8ToString"))
      Module2["UTF8ToString"] = function() {
        abort("'UTF8ToString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stringToUTF8Array"))
      Module2["stringToUTF8Array"] = function() {
        abort("'stringToUTF8Array' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stringToUTF8"))
      Module2["stringToUTF8"] = function() {
        abort("'stringToUTF8' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "lengthBytesUTF8"))
      Module2["lengthBytesUTF8"] = function() {
        abort("'lengthBytesUTF8' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stackTrace"))
      Module2["stackTrace"] = function() {
        abort("'stackTrace' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "addOnPreRun"))
      Module2["addOnPreRun"] = function() {
        abort("'addOnPreRun' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "addOnInit"))
      Module2["addOnInit"] = function() {
        abort("'addOnInit' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "addOnPreMain"))
      Module2["addOnPreMain"] = function() {
        abort("'addOnPreMain' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "addOnExit"))
      Module2["addOnExit"] = function() {
        abort("'addOnExit' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "addOnPostRun"))
      Module2["addOnPostRun"] = function() {
        abort("'addOnPostRun' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeStringToMemory"))
      Module2["writeStringToMemory"] = function() {
        abort("'writeStringToMemory' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeArrayToMemory"))
      Module2["writeArrayToMemory"] = function() {
        abort("'writeArrayToMemory' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeAsciiToMemory"))
      Module2["writeAsciiToMemory"] = function() {
        abort("'writeAsciiToMemory' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "addRunDependency"))
      Module2["addRunDependency"] = function() {
        abort("'addRunDependency' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "removeRunDependency"))
      Module2["removeRunDependency"] = function() {
        abort("'removeRunDependency' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS_createFolder"))
      Module2["FS_createFolder"] = function() {
        abort("'FS_createFolder' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS_createPath"))
      Module2["FS_createPath"] = function() {
        abort("'FS_createPath' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS_createDataFile"))
      Module2["FS_createDataFile"] = function() {
        abort("'FS_createDataFile' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS_createPreloadedFile"))
      Module2["FS_createPreloadedFile"] = function() {
        abort("'FS_createPreloadedFile' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS_createLazyFile"))
      Module2["FS_createLazyFile"] = function() {
        abort("'FS_createLazyFile' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS_createLink"))
      Module2["FS_createLink"] = function() {
        abort("'FS_createLink' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS_createDevice"))
      Module2["FS_createDevice"] = function() {
        abort("'FS_createDevice' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS_unlink"))
      Module2["FS_unlink"] = function() {
        abort("'FS_unlink' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getLEB"))
      Module2["getLEB"] = function() {
        abort("'getLEB' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getFunctionTables"))
      Module2["getFunctionTables"] = function() {
        abort("'getFunctionTables' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "alignFunctionTables"))
      Module2["alignFunctionTables"] = function() {
        abort("'alignFunctionTables' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerFunctions"))
      Module2["registerFunctions"] = function() {
        abort("'registerFunctions' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "addFunction"))
      Module2["addFunction"] = function() {
        abort("'addFunction' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "removeFunction"))
      Module2["removeFunction"] = function() {
        abort("'removeFunction' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getFuncWrapper"))
      Module2["getFuncWrapper"] = function() {
        abort("'getFuncWrapper' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "prettyPrint"))
      Module2["prettyPrint"] = function() {
        abort("'prettyPrint' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "dynCall"))
      Module2["dynCall"] = function() {
        abort("'dynCall' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getCompilerSetting"))
      Module2["getCompilerSetting"] = function() {
        abort("'getCompilerSetting' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "print"))
      Module2["print"] = function() {
        abort("'print' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "printErr"))
      Module2["printErr"] = function() {
        abort("'printErr' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getTempRet0"))
      Module2["getTempRet0"] = function() {
        abort("'getTempRet0' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "setTempRet0"))
      Module2["setTempRet0"] = function() {
        abort("'setTempRet0' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "callMain"))
      Module2["callMain"] = function() {
        abort("'callMain' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "abort"))
      Module2["abort"] = function() {
        abort("'abort' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stringToNewUTF8"))
      Module2["stringToNewUTF8"] = function() {
        abort("'stringToNewUTF8' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "setFileTime"))
      Module2["setFileTime"] = function() {
        abort("'setFileTime' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "abortOnCannotGrowMemory"))
      Module2["abortOnCannotGrowMemory"] = function() {
        abort("'abortOnCannotGrowMemory' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "emscripten_realloc_buffer"))
      Module2["emscripten_realloc_buffer"] = function() {
        abort("'emscripten_realloc_buffer' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "ENV"))
      Module2["ENV"] = function() {
        abort("'ENV' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "ERRNO_CODES"))
      Module2["ERRNO_CODES"] = function() {
        abort("'ERRNO_CODES' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "ERRNO_MESSAGES"))
      Module2["ERRNO_MESSAGES"] = function() {
        abort("'ERRNO_MESSAGES' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "setErrNo"))
      Module2["setErrNo"] = function() {
        abort("'setErrNo' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "inetPton4"))
      Module2["inetPton4"] = function() {
        abort("'inetPton4' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "inetNtop4"))
      Module2["inetNtop4"] = function() {
        abort("'inetNtop4' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "inetPton6"))
      Module2["inetPton6"] = function() {
        abort("'inetPton6' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "inetNtop6"))
      Module2["inetNtop6"] = function() {
        abort("'inetNtop6' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "readSockaddr"))
      Module2["readSockaddr"] = function() {
        abort("'readSockaddr' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeSockaddr"))
      Module2["writeSockaddr"] = function() {
        abort("'writeSockaddr' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "DNS"))
      Module2["DNS"] = function() {
        abort("'DNS' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getHostByName"))
      Module2["getHostByName"] = function() {
        abort("'getHostByName' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "GAI_ERRNO_MESSAGES"))
      Module2["GAI_ERRNO_MESSAGES"] = function() {
        abort("'GAI_ERRNO_MESSAGES' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "Protocols"))
      Module2["Protocols"] = function() {
        abort("'Protocols' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "Sockets"))
      Module2["Sockets"] = function() {
        abort("'Sockets' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getRandomDevice"))
      Module2["getRandomDevice"] = function() {
        abort("'getRandomDevice' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "traverseStack"))
      Module2["traverseStack"] = function() {
        abort("'traverseStack' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "UNWIND_CACHE"))
      Module2["UNWIND_CACHE"] = function() {
        abort("'UNWIND_CACHE' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "withBuiltinMalloc"))
      Module2["withBuiltinMalloc"] = function() {
        abort("'withBuiltinMalloc' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "readAsmConstArgsArray"))
      Module2["readAsmConstArgsArray"] = function() {
        abort("'readAsmConstArgsArray' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "readAsmConstArgs"))
      Module2["readAsmConstArgs"] = function() {
        abort("'readAsmConstArgs' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "mainThreadEM_ASM"))
      Module2["mainThreadEM_ASM"] = function() {
        abort("'mainThreadEM_ASM' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "jstoi_q"))
      Module2["jstoi_q"] = function() {
        abort("'jstoi_q' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "jstoi_s"))
      Module2["jstoi_s"] = function() {
        abort("'jstoi_s' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getExecutableName"))
      Module2["getExecutableName"] = function() {
        abort("'getExecutableName' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "listenOnce"))
      Module2["listenOnce"] = function() {
        abort("'listenOnce' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "autoResumeAudioContext"))
      Module2["autoResumeAudioContext"] = function() {
        abort("'autoResumeAudioContext' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "dynCallLegacy"))
      Module2["dynCallLegacy"] = function() {
        abort("'dynCallLegacy' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getDynCaller"))
      Module2["getDynCaller"] = function() {
        abort("'getDynCaller' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "dynCall"))
      Module2["dynCall"] = function() {
        abort("'dynCall' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "callRuntimeCallbacks"))
      Module2["callRuntimeCallbacks"] = function() {
        abort("'callRuntimeCallbacks' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "runtimeKeepaliveCounter"))
      Module2["runtimeKeepaliveCounter"] = function() {
        abort("'runtimeKeepaliveCounter' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "keepRuntimeAlive"))
      Module2["keepRuntimeAlive"] = function() {
        abort("'keepRuntimeAlive' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "runtimeKeepalivePush"))
      Module2["runtimeKeepalivePush"] = function() {
        abort("'runtimeKeepalivePush' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "runtimeKeepalivePop"))
      Module2["runtimeKeepalivePop"] = function() {
        abort("'runtimeKeepalivePop' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "callUserCallback"))
      Module2["callUserCallback"] = function() {
        abort("'callUserCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "maybeExit"))
      Module2["maybeExit"] = function() {
        abort("'maybeExit' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "asmjsMangle"))
      Module2["asmjsMangle"] = function() {
        abort("'asmjsMangle' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "reallyNegative"))
      Module2["reallyNegative"] = function() {
        abort("'reallyNegative' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "unSign"))
      Module2["unSign"] = function() {
        abort("'unSign' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "reSign"))
      Module2["reSign"] = function() {
        abort("'reSign' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "formatString"))
      Module2["formatString"] = function() {
        abort("'formatString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "PATH"))
      Module2["PATH"] = function() {
        abort("'PATH' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "PATH_FS"))
      Module2["PATH_FS"] = function() {
        abort("'PATH_FS' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "SYSCALLS"))
      Module2["SYSCALLS"] = function() {
        abort("'SYSCALLS' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "syscallMmap2"))
      Module2["syscallMmap2"] = function() {
        abort("'syscallMmap2' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "syscallMunmap"))
      Module2["syscallMunmap"] = function() {
        abort("'syscallMunmap' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getSocketFromFD"))
      Module2["getSocketFromFD"] = function() {
        abort("'getSocketFromFD' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getSocketAddress"))
      Module2["getSocketAddress"] = function() {
        abort("'getSocketAddress' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "JSEvents"))
      Module2["JSEvents"] = function() {
        abort("'JSEvents' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerKeyEventCallback"))
      Module2["registerKeyEventCallback"] = function() {
        abort("'registerKeyEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "specialHTMLTargets"))
      Module2["specialHTMLTargets"] = function() {
        abort("'specialHTMLTargets' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "maybeCStringToJsString"))
      Module2["maybeCStringToJsString"] = function() {
        abort("'maybeCStringToJsString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "findEventTarget"))
      Module2["findEventTarget"] = function() {
        abort("'findEventTarget' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "findCanvasEventTarget"))
      Module2["findCanvasEventTarget"] = function() {
        abort("'findCanvasEventTarget' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getBoundingClientRect"))
      Module2["getBoundingClientRect"] = function() {
        abort("'getBoundingClientRect' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillMouseEventData"))
      Module2["fillMouseEventData"] = function() {
        abort("'fillMouseEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerMouseEventCallback"))
      Module2["registerMouseEventCallback"] = function() {
        abort("'registerMouseEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerWheelEventCallback"))
      Module2["registerWheelEventCallback"] = function() {
        abort("'registerWheelEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerUiEventCallback"))
      Module2["registerUiEventCallback"] = function() {
        abort("'registerUiEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerFocusEventCallback"))
      Module2["registerFocusEventCallback"] = function() {
        abort("'registerFocusEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillDeviceOrientationEventData"))
      Module2["fillDeviceOrientationEventData"] = function() {
        abort("'fillDeviceOrientationEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerDeviceOrientationEventCallback"))
      Module2["registerDeviceOrientationEventCallback"] = function() {
        abort("'registerDeviceOrientationEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillDeviceMotionEventData"))
      Module2["fillDeviceMotionEventData"] = function() {
        abort("'fillDeviceMotionEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerDeviceMotionEventCallback"))
      Module2["registerDeviceMotionEventCallback"] = function() {
        abort("'registerDeviceMotionEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "screenOrientation"))
      Module2["screenOrientation"] = function() {
        abort("'screenOrientation' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillOrientationChangeEventData"))
      Module2["fillOrientationChangeEventData"] = function() {
        abort("'fillOrientationChangeEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerOrientationChangeEventCallback"))
      Module2["registerOrientationChangeEventCallback"] = function() {
        abort("'registerOrientationChangeEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillFullscreenChangeEventData"))
      Module2["fillFullscreenChangeEventData"] = function() {
        abort("'fillFullscreenChangeEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerFullscreenChangeEventCallback"))
      Module2["registerFullscreenChangeEventCallback"] = function() {
        abort("'registerFullscreenChangeEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerRestoreOldStyle"))
      Module2["registerRestoreOldStyle"] = function() {
        abort("'registerRestoreOldStyle' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "hideEverythingExceptGivenElement"))
      Module2["hideEverythingExceptGivenElement"] = function() {
        abort("'hideEverythingExceptGivenElement' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "restoreHiddenElements"))
      Module2["restoreHiddenElements"] = function() {
        abort("'restoreHiddenElements' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "setLetterbox"))
      Module2["setLetterbox"] = function() {
        abort("'setLetterbox' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "currentFullscreenStrategy"))
      Module2["currentFullscreenStrategy"] = function() {
        abort("'currentFullscreenStrategy' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "restoreOldWindowedStyle"))
      Module2["restoreOldWindowedStyle"] = function() {
        abort("'restoreOldWindowedStyle' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "softFullscreenResizeWebGLRenderTarget"))
      Module2["softFullscreenResizeWebGLRenderTarget"] = function() {
        abort("'softFullscreenResizeWebGLRenderTarget' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "doRequestFullscreen"))
      Module2["doRequestFullscreen"] = function() {
        abort("'doRequestFullscreen' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillPointerlockChangeEventData"))
      Module2["fillPointerlockChangeEventData"] = function() {
        abort("'fillPointerlockChangeEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerPointerlockChangeEventCallback"))
      Module2["registerPointerlockChangeEventCallback"] = function() {
        abort("'registerPointerlockChangeEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerPointerlockErrorEventCallback"))
      Module2["registerPointerlockErrorEventCallback"] = function() {
        abort("'registerPointerlockErrorEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "requestPointerLock"))
      Module2["requestPointerLock"] = function() {
        abort("'requestPointerLock' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillVisibilityChangeEventData"))
      Module2["fillVisibilityChangeEventData"] = function() {
        abort("'fillVisibilityChangeEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerVisibilityChangeEventCallback"))
      Module2["registerVisibilityChangeEventCallback"] = function() {
        abort("'registerVisibilityChangeEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerTouchEventCallback"))
      Module2["registerTouchEventCallback"] = function() {
        abort("'registerTouchEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillGamepadEventData"))
      Module2["fillGamepadEventData"] = function() {
        abort("'fillGamepadEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerGamepadEventCallback"))
      Module2["registerGamepadEventCallback"] = function() {
        abort("'registerGamepadEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerBeforeUnloadEventCallback"))
      Module2["registerBeforeUnloadEventCallback"] = function() {
        abort("'registerBeforeUnloadEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "fillBatteryEventData"))
      Module2["fillBatteryEventData"] = function() {
        abort("'fillBatteryEventData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "battery"))
      Module2["battery"] = function() {
        abort("'battery' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "registerBatteryEventCallback"))
      Module2["registerBatteryEventCallback"] = function() {
        abort("'registerBatteryEventCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "setCanvasElementSize"))
      Module2["setCanvasElementSize"] = function() {
        abort("'setCanvasElementSize' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getCanvasElementSize"))
      Module2["getCanvasElementSize"] = function() {
        abort("'getCanvasElementSize' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "polyfillSetImmediate"))
      Module2["polyfillSetImmediate"] = function() {
        abort("'polyfillSetImmediate' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "demangle"))
      Module2["demangle"] = function() {
        abort("'demangle' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "demangleAll"))
      Module2["demangleAll"] = function() {
        abort("'demangleAll' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "jsStackTrace"))
      Module2["jsStackTrace"] = function() {
        abort("'jsStackTrace' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stackTrace"))
      Module2["stackTrace"] = function() {
        abort("'stackTrace' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getEnvStrings"))
      Module2["getEnvStrings"] = function() {
        abort("'getEnvStrings' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "checkWasiClock"))
      Module2["checkWasiClock"] = function() {
        abort("'checkWasiClock' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "flush_NO_FILESYSTEM"))
      Module2["flush_NO_FILESYSTEM"] = function() {
        abort("'flush_NO_FILESYSTEM' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeI53ToI64"))
      Module2["writeI53ToI64"] = function() {
        abort("'writeI53ToI64' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeI53ToI64Clamped"))
      Module2["writeI53ToI64Clamped"] = function() {
        abort("'writeI53ToI64Clamped' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeI53ToI64Signaling"))
      Module2["writeI53ToI64Signaling"] = function() {
        abort("'writeI53ToI64Signaling' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeI53ToU64Clamped"))
      Module2["writeI53ToU64Clamped"] = function() {
        abort("'writeI53ToU64Clamped' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeI53ToU64Signaling"))
      Module2["writeI53ToU64Signaling"] = function() {
        abort("'writeI53ToU64Signaling' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "readI53FromI64"))
      Module2["readI53FromI64"] = function() {
        abort("'readI53FromI64' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "readI53FromU64"))
      Module2["readI53FromU64"] = function() {
        abort("'readI53FromU64' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "convertI32PairToI53"))
      Module2["convertI32PairToI53"] = function() {
        abort("'convertI32PairToI53' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "convertU32PairToI53"))
      Module2["convertU32PairToI53"] = function() {
        abort("'convertU32PairToI53' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "uncaughtExceptionCount"))
      Module2["uncaughtExceptionCount"] = function() {
        abort("'uncaughtExceptionCount' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "exceptionLast"))
      Module2["exceptionLast"] = function() {
        abort("'exceptionLast' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "exceptionCaught"))
      Module2["exceptionCaught"] = function() {
        abort("'exceptionCaught' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "ExceptionInfoAttrs"))
      Module2["ExceptionInfoAttrs"] = function() {
        abort("'ExceptionInfoAttrs' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "ExceptionInfo"))
      Module2["ExceptionInfo"] = function() {
        abort("'ExceptionInfo' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "CatchInfo"))
      Module2["CatchInfo"] = function() {
        abort("'CatchInfo' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "exception_addRef"))
      Module2["exception_addRef"] = function() {
        abort("'exception_addRef' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "exception_decRef"))
      Module2["exception_decRef"] = function() {
        abort("'exception_decRef' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "Browser"))
      Module2["Browser"] = function() {
        abort("'Browser' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "funcWrappers"))
      Module2["funcWrappers"] = function() {
        abort("'funcWrappers' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "getFuncWrapper"))
      Module2["getFuncWrapper"] = function() {
        abort("'getFuncWrapper' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "setMainLoop"))
      Module2["setMainLoop"] = function() {
        abort("'setMainLoop' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "FS"))
      Module2["FS"] = function() {
        abort("'FS' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "mmapAlloc"))
      Module2["mmapAlloc"] = function() {
        abort("'mmapAlloc' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "MEMFS"))
      Module2["MEMFS"] = function() {
        abort("'MEMFS' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "TTY"))
      Module2["TTY"] = function() {
        abort("'TTY' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "PIPEFS"))
      Module2["PIPEFS"] = function() {
        abort("'PIPEFS' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "SOCKFS"))
      Module2["SOCKFS"] = function() {
        abort("'SOCKFS' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "_setNetworkCallback"))
      Module2["_setNetworkCallback"] = function() {
        abort("'_setNetworkCallback' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "tempFixedLengthArray"))
      Module2["tempFixedLengthArray"] = function() {
        abort("'tempFixedLengthArray' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "miniTempWebGLFloatBuffers"))
      Module2["miniTempWebGLFloatBuffers"] = function() {
        abort("'miniTempWebGLFloatBuffers' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "heapObjectForWebGLType"))
      Module2["heapObjectForWebGLType"] = function() {
        abort("'heapObjectForWebGLType' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "heapAccessShiftForWebGLHeap"))
      Module2["heapAccessShiftForWebGLHeap"] = function() {
        abort("'heapAccessShiftForWebGLHeap' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "GL"))
      Module2["GL"] = function() {
        abort("'GL' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "emscriptenWebGLGet"))
      Module2["emscriptenWebGLGet"] = function() {
        abort("'emscriptenWebGLGet' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "computeUnpackAlignedImageSize"))
      Module2["computeUnpackAlignedImageSize"] = function() {
        abort("'computeUnpackAlignedImageSize' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "emscriptenWebGLGetTexPixelData"))
      Module2["emscriptenWebGLGetTexPixelData"] = function() {
        abort("'emscriptenWebGLGetTexPixelData' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "emscriptenWebGLGetUniform"))
      Module2["emscriptenWebGLGetUniform"] = function() {
        abort("'emscriptenWebGLGetUniform' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "webglGetUniformLocation"))
      Module2["webglGetUniformLocation"] = function() {
        abort("'webglGetUniformLocation' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "webglPrepareUniformLocationsBeforeFirstUse"))
      Module2["webglPrepareUniformLocationsBeforeFirstUse"] = function() {
        abort("'webglPrepareUniformLocationsBeforeFirstUse' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "webglGetLeftBracePos"))
      Module2["webglGetLeftBracePos"] = function() {
        abort("'webglGetLeftBracePos' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "emscriptenWebGLGetVertexAttrib"))
      Module2["emscriptenWebGLGetVertexAttrib"] = function() {
        abort("'emscriptenWebGLGetVertexAttrib' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "writeGLArray"))
      Module2["writeGLArray"] = function() {
        abort("'writeGLArray' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "AL"))
      Module2["AL"] = function() {
        abort("'AL' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "SDL_unicode"))
      Module2["SDL_unicode"] = function() {
        abort("'SDL_unicode' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "SDL_ttfContext"))
      Module2["SDL_ttfContext"] = function() {
        abort("'SDL_ttfContext' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "SDL_audio"))
      Module2["SDL_audio"] = function() {
        abort("'SDL_audio' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "SDL"))
      Module2["SDL"] = function() {
        abort("'SDL' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "SDL_gfx"))
      Module2["SDL_gfx"] = function() {
        abort("'SDL_gfx' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "GLUT"))
      Module2["GLUT"] = function() {
        abort("'GLUT' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "EGL"))
      Module2["EGL"] = function() {
        abort("'EGL' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "GLFW_Window"))
      Module2["GLFW_Window"] = function() {
        abort("'GLFW_Window' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "GLFW"))
      Module2["GLFW"] = function() {
        abort("'GLFW' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "GLEW"))
      Module2["GLEW"] = function() {
        abort("'GLEW' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "IDBStore"))
      Module2["IDBStore"] = function() {
        abort("'IDBStore' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "runAndAbortIfError"))
      Module2["runAndAbortIfError"] = function() {
        abort("'runAndAbortIfError' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "warnOnce"))
      Module2["warnOnce"] = function() {
        abort("'warnOnce' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stackSave"))
      Module2["stackSave"] = function() {
        abort("'stackSave' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stackRestore"))
      Module2["stackRestore"] = function() {
        abort("'stackRestore' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stackAlloc"))
      Module2["stackAlloc"] = function() {
        abort("'stackAlloc' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "AsciiToString"))
      Module2["AsciiToString"] = function() {
        abort("'AsciiToString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stringToAscii"))
      Module2["stringToAscii"] = function() {
        abort("'stringToAscii' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "UTF16ToString"))
      Module2["UTF16ToString"] = function() {
        abort("'UTF16ToString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stringToUTF16"))
      Module2["stringToUTF16"] = function() {
        abort("'stringToUTF16' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "lengthBytesUTF16"))
      Module2["lengthBytesUTF16"] = function() {
        abort("'lengthBytesUTF16' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "UTF32ToString"))
      Module2["UTF32ToString"] = function() {
        abort("'UTF32ToString' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "stringToUTF32"))
      Module2["stringToUTF32"] = function() {
        abort("'stringToUTF32' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "lengthBytesUTF32"))
      Module2["lengthBytesUTF32"] = function() {
        abort("'lengthBytesUTF32' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "allocateUTF8"))
      Module2["allocateUTF8"] = function() {
        abort("'allocateUTF8' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    if (!Object.getOwnPropertyDescriptor(Module2, "allocateUTF8OnStack"))
      Module2["allocateUTF8OnStack"] = function() {
        abort("'allocateUTF8OnStack' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      };
    Module2["writeStackCookie"] = writeStackCookie;
    Module2["checkStackCookie"] = checkStackCookie;
    if (!Object.getOwnPropertyDescriptor(Module2, "ALLOC_NORMAL"))
      Object.defineProperty(Module2, "ALLOC_NORMAL", { configurable: true, get: function() {
        abort("'ALLOC_NORMAL' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      } });
    if (!Object.getOwnPropertyDescriptor(Module2, "ALLOC_STACK"))
      Object.defineProperty(Module2, "ALLOC_STACK", { configurable: true, get: function() {
        abort("'ALLOC_STACK' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)");
      } });
    var calledRun;
    function ExitStatus(status) {
      this.name = "ExitStatus";
      this.message = "Program terminated with exit(" + status + ")";
      this.status = status;
    }
    var calledMain = false;
    dependenciesFulfilled = function runCaller() {
      if (!calledRun)
        run();
      if (!calledRun)
        dependenciesFulfilled = runCaller;
    };
    function stackCheckInit() {
      _emscripten_stack_init();
      writeStackCookie();
    }
    function run(args) {
      args = args || arguments_;
      if (runDependencies > 0) {
        return;
      }
      stackCheckInit();
      preRun();
      if (runDependencies > 0) {
        return;
      }
      function doRun() {
        if (calledRun)
          return;
        calledRun = true;
        Module2["calledRun"] = true;
        if (ABORT)
          return;
        initRuntime();
        readyPromiseResolve(Module2);
        if (Module2["onRuntimeInitialized"])
          Module2["onRuntimeInitialized"]();
        assert(!Module2["_main"], 'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]');
        postRun();
      }
      if (Module2["setStatus"]) {
        Module2["setStatus"]("Running...");
        setTimeout(function() {
          setTimeout(function() {
            Module2["setStatus"]("");
          }, 1);
          doRun();
        }, 1);
      } else {
        doRun();
      }
      checkStackCookie();
    }
    Module2["run"] = run;
    function checkUnflushedContent() {
      var oldOut = out;
      var oldErr = err;
      var has = false;
      out = err = function(x) {
        has = true;
      };
      try {
        var flush = null;
        if (flush)
          flush();
      } catch (e) {
      }
      out = oldOut;
      err = oldErr;
      if (has) {
        warnOnce("stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the FAQ), or make sure to emit a newline when you printf etc.");
        warnOnce("(this may also be due to not including full filesystem support - try building with -s FORCE_FILESYSTEM=1)");
      }
    }
    function exit(status, implicit) {
      EXITSTATUS = status;
      checkUnflushedContent();
      if (implicit && keepRuntimeAlive() && status === 0) {
        return;
      }
      if (keepRuntimeAlive()) {
        if (!implicit) {
          var msg = "program exited (with status: " + status + "), but EXIT_RUNTIME is not set, so halting execution but not exiting the runtime or preventing further async execution (build with EXIT_RUNTIME=1, if you want a true shutdown)";
          readyPromiseReject(msg);
          err(msg);
        }
      } else {
        exitRuntime();
        if (Module2["onExit"])
          Module2["onExit"](status);
        ABORT = true;
      }
      quit_(status, new ExitStatus(status));
    }
    if (Module2["preInit"]) {
      if (typeof Module2["preInit"] == "function")
        Module2["preInit"] = [Module2["preInit"]];
      while (Module2["preInit"].length > 0) {
        Module2["preInit"].pop()();
      }
    }
    run();
    return Module2.ready;
  };
}();
var nurbs_wrapper_default = Module;

// /projects/Novorender/ts/dist/measure/worker/loader.ts
common_exports.setMatrixArrayType(Array);
function matFromInstance(instance) {
  if (instance.transformation !== void 0) {
    return mat4_exports.fromValues(
      ...instance.transformation
    );
  }
  return mat4_exports.identity(mat4_exports.create());
}
function unitToScale(unit) {
  switch (unit) {
    case "mm":
      return 1 / 1e3;
    case "cm":
      return 1 / 100;
    case "in":
      return 0.0254;
    default:
      return 1;
  }
}
async function createGeometryFactory(wasmUrl) {
  const factoryArg = typeof wasmUrl == "string" ? { locateFile: (path) => wasmUrl } : { wasmBinary: wasmUrl };
  const wasmInstance = await nurbs_wrapper_default(factoryArg);
  var dataPtr = wasmInstance._malloc(48);
  var dataHeap = new Float64Array(wasmInstance.HEAPF64.buffer, dataPtr, 6);
  return new GeometryFactory(wasmInstance, dataHeap);
}
function crawlInstance(product, instanceData, faceFunc) {
  const geometryData = product.geometries[instanceData.geometry];
  if (geometryData.shells) {
    for (const shellIdx of geometryData.shells) {
      const shell = product.shells[shellIdx];
      for (const faceIdx of shell.faces) {
        faceFunc(faceIdx);
      }
    }
  }
  if (geometryData.solids) {
    for (const solidIdx of geometryData.solids) {
      const solid = product.solids[solidIdx];
      for (const faceIdx of product.shells[solid.outerShell].faces) {
        faceFunc(faceIdx);
      }
      if (solid.innerShells) {
        for (const innerShellIdx of solid.innerShells) {
          const shell = product.shells[innerShellIdx];
          for (const faceIdx of shell.faces) {
            faceFunc(faceIdx);
          }
        }
      }
    }
  }
}
var GeometryFactory = class {
  constructor(wasmInstance, buffer) {
    this.wasmInstance = wasmInstance;
    this.buffer = buffer;
  }
  getCurve2D(data, halfEdgeIndex) {
    const halfEdgeData = data.halfEdges[halfEdgeIndex];
    if (halfEdgeData.curve2D == void 0) {
      return void 0;
    }
    let [beginParam, endParam] = halfEdgeData.parameterBounds;
    let sense = 1;
    if (halfEdgeData.direction < 0) {
      sense = -1;
      [beginParam, endParam] = [endParam, beginParam];
    }
    const curveData = data.curves2D[halfEdgeData.curve2D];
    switch (curveData.kind) {
      case "line": {
        const origin2 = vec2_exports.fromValues(
          ...curveData.origin
        );
        const direction2 = vec2_exports.fromValues(
          ...curveData.direction
        );
        return new Line2D(origin2, direction2, beginParam, endParam, sense);
      }
      case "circle": {
        const origin2 = vec2_exports.fromValues(
          ...curveData.origin
        );
        const { radius } = curveData;
        return new Arc2D(origin2, radius, beginParam, endParam, sense);
      }
      case "nurbs": {
        const { order, controlPoints, knots, weights } = curveData;
        return new NurbsCurve2D(
          order,
          controlPoints,
          knots,
          weights,
          beginParam,
          endParam,
          sense,
          this.wasmInstance,
          this.buffer
        );
      }
      default:
        throw Error(`Unsupported curve type!`);
    }
  }
  getCurve3D(data, halfEdgeIndex) {
    const halfEdgeData = data.halfEdges[halfEdgeIndex];
    return this.getCurve3DFromEdge(
      data,
      halfEdgeData.edge,
      halfEdgeData.direction
    );
  }
  getHalfEdgeAABB(data, halfEdgeIndex) {
    const halfEdgeData = data.halfEdges[halfEdgeIndex];
    if (halfEdgeData.aabb) {
      return halfEdgeData.aabb;
    }
    const curve = this.getCurve2D(data, halfEdgeIndex);
    if (!curve) {
      return void 0;
    }
    const points = [];
    switch (curve.kind) {
      case "line":
        points.push(vec2_exports.create());
        points.push(vec2_exports.create());
        curve.eval(curve.beginParam, points[0], void 0);
        curve.eval(curve.endParam, points[1], void 0);
        break;
      case "arc":
        points.push(vec2_exports.create());
        points.push(vec2_exports.create());
        curve.eval(curve.beginParam, points[0], void 0);
        curve.eval(curve.endParam, points[1], void 0);
        const paramOffset = curve.endParam > 2 * Math.PI ? -Math.PI * 2 : 0;
        for (let i = 1; i < 4; ++i) {
          const param = Math.PI / 2 * i + paramOffset;
          if (param >= curve.beginParam && param <= curve.endParam) {
            const point = vec2_exports.create();
            curve.eval(param, point, void 0);
            points.push(point);
          }
        }
        break;
      default:
        return void 0;
    }
    const min4 = vec2_exports.copy(vec2_exports.create(), points[0]);
    const max4 = vec2_exports.copy(vec2_exports.create(), points[0]);
    for (let i = 1; i < points.length; ++i) {
      vec2_exports.min(min4, min4, points[i]);
      vec2_exports.max(max4, max4, points[i]);
    }
    return { min: min4, max: max4 };
  }
  getCurve3DFromEdgeOrSegment(data, segmentData) {
    if (segmentData.curve3D != void 0) {
      let [beginParam, endParam] = segmentData.parameterBounds;
      const curveData = data.curves3D[segmentData.curve3D];
      switch (curveData.kind) {
        case "line": {
          const origin2 = vec3_exports.fromValues(
            ...curveData.origin
          );
          const direction2 = vec3_exports.fromValues(
            ...curveData.direction
          );
          return new Line3D(
            origin2,
            direction2,
            beginParam,
            endParam,
            1,
            segmentData.tesselationParameters
          );
        }
        case "circle": {
          const origin2 = vec3_exports.fromValues(
            ...curveData.origin
          );
          const { radius, axisX, axisY } = curveData;
          return new Arc3D(
            origin2,
            axisX,
            axisY,
            radius,
            beginParam,
            endParam,
            1,
            segmentData.tesselationParameters
          );
        }
        case "nurbs": {
          const { order, controlPoints, knots, weights } = curveData;
          return new NurbsCurve3D(
            order,
            controlPoints,
            knots,
            weights,
            beginParam,
            endParam,
            1,
            segmentData.tesselationParameters,
            this.wasmInstance,
            this.buffer
          );
        }
        case "lineStrip": {
          return new LineStrip3D(
            curveData.vertices,
            beginParam,
            endParam,
            segmentData.tesselationParameters
          );
        }
        default:
          throw Error(`Unsupported curve type!`);
      }
    }
  }
  getCurve3DFromSegment(data, segmentIndex) {
    return this.getCurve3DFromEdgeOrSegment(
      data,
      data.curveSegments[segmentIndex]
    );
  }
  getCurve3DFromEdge(data, edgeIndex, sense = 1) {
    return this.getCurve3DFromEdgeOrSegment(data, data.edges[edgeIndex]);
  }
  getSurface(data, sense, scale6) {
    switch (data.kind) {
      case "plane": {
        const transform = mat4_exports.fromValues(
          ...data.transform
        );
        return new Plane(transform, sense, scale6);
      }
      case "cylinder": {
        const transform = mat4_exports.fromValues(
          ...data.transform
        );
        return new Cylinder(data.radius, transform, sense, scale6);
      }
      case "cone": {
        const transform = mat4_exports.fromValues(
          ...data.transform
        );
        return new Cone(
          data.radius,
          data.halfAngleTan,
          transform,
          sense,
          scale6
        );
      }
      case "torus": {
        const transform = mat4_exports.fromValues(
          ...data.transform
        );
        return new Torus(
          data.majorRadius,
          data.minorRadius,
          transform,
          sense,
          scale6
        );
      }
      case "nurbs": {
        return new Nurbs(
          data.orders,
          data.dim,
          data.controlPoints,
          data.knots,
          data.weights,
          sense,
          this.wasmInstance,
          this.buffer,
          scale6
        );
      }
      default:
        throw Error(`Unsupported surface type!`);
    }
  }
  makeFace(face, instance, instanceIndex, product, curves2D) {
    const loops = [face.outerLoop, ...face.innerLoops ?? []];
    const virtualEdges = /* @__PURE__ */ new Set();
    const faceCurves2D = loops.map((l) => {
      return product.loops[l].halfEdges.map((e) => {
        const halfEdge = product.halfEdges[e];
        const edgeIndex = halfEdge.edge;
        const edge = product.edges[edgeIndex];
        if (edge.virtual) {
          virtualEdges.add(edgeIndex);
        }
        return curves2D[e];
      });
    });
    const seams = [];
    for (const ei of virtualEdges) {
      const edge = product.edges[ei];
      const [a, b] = edge.halfEdges;
      if (b != null) {
        console.assert(product.halfEdges[a].face == product.halfEdges[b].face);
        const ia = product.halfEdges[a].faceVertexIndices;
        const ib = product.halfEdges[b].faceVertexIndices;
        console.assert(ia.length == ib.length);
        const vertexIndexPairs = [];
        for (let i = 0; i < ia.length; i++) {
          vertexIndexPairs.push([ia[i], ib[i]]);
        }
        seams.push({ vertexIndexPairs });
      }
    }
    const surface = this.getSurface(
      product.surfaces[face.surface],
      face.facing
    );
    return new Face(
      surface,
      face.facing,
      faceCurves2D,
      face.triangulation,
      seams,
      instanceIndex,
      instance.transformation ? matFromInstance(instance) : void 0
    );
  }
  getFaces(product) {
    const curves2D = [];
    for (let i = 0; i < product.halfEdges.length; ++i) {
      const curve = this.getCurve2D(product, i);
      if (curve) {
        curves2D.push(curve);
      }
    }
    const faces = [];
    if (curves2D.length == 0) {
      return faces;
    }
    for (let i = 0; i < product.instances.length; ++i) {
      const instance = product.instances[i];
      const faceFunc = (faceIdx) => {
        faces.push(
          this.makeFace(product.faces[faceIdx], instance, i, product, curves2D)
        );
      };
      if (typeof instance.geometry == "number") {
        crawlInstance(product, instance, faceFunc);
      }
    }
    return faces;
  }
  getCurvesFromEdges(product, edgeInstances) {
    const curves = new Array();
    for (let i = 0; i < product.edges.length; ++i) {
      const curve = this.getCurve3DFromEdge(product, i);
      const edgeData = product.edges[i];
      if (curve && !edgeData.virtual) {
        const instance = product.instances[edgeInstances[i]];
        const transform = mat4_exports.create();
        if (instance.transformation) {
          mat4_exports.mul(transform, transform, matFromInstance(instance));
        }
        curves.push(new Edge(curve, transform, edgeInstances[i]));
      } else {
        curves.push(void 0);
      }
    }
    return curves;
  }
  getEdges(product) {
    const edgeInstances = new Array(product.edges.length);
    for (let i = 0; i < product.instances.length; ++i) {
      const addFaceEdges = (faceIdx) => {
        const face = product.faces[faceIdx];
        const loops = [face.outerLoop, ...face.innerLoops ?? []];
        for (const loopIdx of loops) {
          const loop = product.loops[loopIdx];
          for (const halfEdgeIdx of loop.halfEdges) {
            const halfEdge = product.halfEdges[halfEdgeIdx];
            edgeInstances[halfEdge.edge] = i;
          }
        }
      };
      const instance = product.instances[i];
      if (typeof instance.geometry == "number") {
        crawlInstance(product, instance, addFaceEdges);
      }
    }
    return this.getCurvesFromEdges(product, edgeInstances);
  }
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

// /projects/Novorender/ts/dist/measure/worker/util.ts
common_exports.setMatrixArrayType(Array);
async function swapCylinderImpl(product, faceIdx, instanceIdx, to) {
  const faceData = product.faces[faceIdx];
  const surfaceData = product.surfaces[faceData.surface];
  if (surfaceData.kind == "cylinder") {
    const cylinderData = surfaceData;
    const mat = matFromInstance(product.instances[instanceIdx]);
    const [cylinderOrigo, cylinderEnd] = await cylinderCenterLine(
      product,
      faceData,
      cylinderData,
      mat,
      "center"
    );
    let selectedIdx = void 0;
    let currentRadius = surfaceData.radius;
    const loopShell = async (shellIdx) => {
      const shell = product.shells[shellIdx];
      for (const currentFaceIdx of shell.faces) {
        if (currentFaceIdx != faceIdx) {
          const face = product.faces[currentFaceIdx];
          const surface = product.surfaces[face.surface];
          if (surface.kind == "cylinder") {
            if (to == "outer" && surface.radius > currentRadius || to == "inner" && surface.radius < currentRadius) {
              const [currentCylinderOrigo, currentCylinderEnd] = await cylinderCenterLine(
                product,
                face,
                surface,
                mat,
                "center"
              );
              if (vec3_exports.dist(currentCylinderOrigo, cylinderOrigo) < 0.01 && vec3_exports.dist(currentCylinderEnd, cylinderEnd) < 0.01) {
                selectedIdx = currentFaceIdx;
                currentRadius = surface.radius;
              }
            }
          }
        }
      }
    };
    for (const instance of product.instances) {
      const geom = product.geometries[instance.geometry];
      if (geom.shells) {
        for (const shellIdx of geom.shells) {
          await loopShell(shellIdx);
        }
      }
      if (geom.solids) {
        for (const solidIdx of geom.solids) {
          const solid = product.solids[solidIdx];
          await loopShell(solid.outerShell);
        }
      }
    }
    return selectedIdx;
  }
}
function closestPointToLine(point, lineStart, lineEnd, projectedPoint2) {
  const lineVec = vec3_exports.sub(vec3_exports.create(), lineEnd, lineStart);
  const startToP = vec3_exports.sub(vec3_exports.create(), point, lineStart);
  const t = vec3_exports.dot(lineVec, startToP) / vec3_exports.dot(lineVec, lineVec);
  if (projectedPoint2) {
    vec3_exports.lerp(projectedPoint2, lineStart, lineEnd, t);
  }
  if (t < 0) {
    return { pos: lineStart, parameter: 0 };
  }
  if (t > 1) {
    return { pos: lineEnd, parameter: 1 };
  }
  return { pos: vec3_exports.lerp(vec3_exports.create(), lineStart, lineEnd, t), parameter: t };
}
function getProfile(vertices, tesselationParameters, transform) {
  const profile = [];
  let prev = transform ? vec3_exports.transformMat4(vec3_exports.create(), vertices[0], transform) : vertices[0];
  let len4 = 0;
  profile.push(
    tesselationParameters ? vec2_exports.fromValues(tesselationParameters[0], prev[2]) : vec2_exports.fromValues(len4, prev[2])
  );
  for (let i = 1; i < vertices.length; ++i) {
    const p = transform ? vec3_exports.transformMat4(vec3_exports.create(), vertices[i], transform) : vertices[i];
    if (tesselationParameters) {
      profile.push(vec2_exports.fromValues(tesselationParameters[i], p[2]));
    } else {
      len4 += vec2_exports.distance(
        vec2_exports.fromValues(prev[0], prev[1]),
        vec2_exports.fromValues(p[0], p[1])
      );
      profile.push(vec2_exports.fromValues(len4, p[2]));
    }
    prev = p;
  }
  return profile;
}
function reduceLineStrip(lineStrip) {
  const reducedStrip = [];
  if (lineStrip.length > 0) {
    let prevPoint = lineStrip[0];
    reducedStrip.push(prevPoint);
    for (let i = 0; i < lineStrip.length; ++i) {
      const currentPoint = lineStrip[i];
      if (vec3_exports.distance(prevPoint, currentPoint) > 5e-3) {
        reducedStrip.push(currentPoint);
      }
      prevPoint = currentPoint;
    }
  }
  return reducedStrip;
}
var Downloader = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  activeDownloads = 0;
  async request(filename) {
    const url = new URL(filename, this.baseUrl);
    if (!url.search)
      url.search = this.baseUrl?.search ?? "";
    const request = new Request(url, { mode: "cors" });
    const response = await requestOfflineFile(request) ?? await fetch(url.toString(), { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}: ${response.statusText}`);
    }
    return response;
  }
  async downloadJson(filename) {
    try {
      this.activeDownloads++;
      const response = await this.request(filename);
      return await response.json();
    } finally {
      this.activeDownloads--;
    }
  }
  async downloadArrayBuffer(filename) {
    const response = await this.request(filename);
    return await response.arrayBuffer();
  }
};

// /projects/Novorender/ts/dist/measure/worker/curves.ts
common_exports.setMatrixArrayType(Array);
function lineToSegment(line, mat) {
  const start = vec3_exports.create();
  const end = vec3_exports.create();
  const dir = vec3_exports.create();
  line.eval(line.beginParam, start, dir);
  line.eval(line.endParam, end, void 0);
  vec3_exports.transformMat4(start, start, mat);
  vec3_exports.transformMat4(end, end, mat);
  const normalMat = mat3_exports.normalFromMat4(mat3_exports.create(), mat);
  vec3_exports.transformMat3(dir, dir, normalMat);
  vec3_exports.normalize(dir, dir);
  return { dir, start, end };
}
var DisposableCurve = class {
  dispose() {
  }
};
var LineStrip3D = class {
  constructor(vertices, beginParam, endParam, tesselationParameters) {
    this.vertices = vertices;
    this.beginParam = beginParam;
    this.endParam = endParam;
    this.tesselationParameters = tesselationParameters;
  }
  kind = "lineStrip";
  sense = 1;
  eval(t, point, tangent) {
    const { vertices, endParam, beginParam, tesselationParameters } = this;
    let segIndex = 0;
    if (t >= endParam) {
      segIndex = tesselationParameters.length - 1;
    } else if (t <= beginParam) {
      segIndex = 0;
    } else {
      while (t < endParam && segIndex < tesselationParameters.length - 1) {
        if (t < tesselationParameters[segIndex + 1]) {
          break;
        }
        ++segIndex;
      }
    }
    const start = vertices[segIndex];
    const dir = segIndex < vertices.length - 1 ? vec3_exports.subtract(vec3_exports.create(), vertices[segIndex + 1], start) : vec3_exports.subtract(vec3_exports.create(), start, vertices[segIndex - 1]);
    vec3_exports.normalize(dir, dir);
    if (point) {
      const segStartParam = tesselationParameters[segIndex];
      const localParam = t - segStartParam;
      vec3_exports.scale(point, dir, localParam);
      vec3_exports.add(point, point, start);
    }
    if (tangent) {
      vec3_exports.copy(tangent, dir);
    }
  }
  invert(pos) {
    const { vertices, tesselationParameters } = this;
    let smallestDist = Number.MAX_VALUE;
    let closestParameter = 0;
    for (let i = 0; i < vertices.length - 1; ++i) {
      const p = closestPointToLine(pos, vertices[i], vertices[i + 1]);
      const dist4 = vec3_exports.dist(p.pos, pos);
      if (dist4 < smallestDist) {
        smallestDist = dist4;
        const segLength = tesselationParameters[i + 1] - tesselationParameters[i];
        closestParameter = tesselationParameters[i] + segLength * p.parameter;
      }
    }
    return closestParameter;
  }
  toSegments(transform) {
    const { vertices, tesselationParameters } = this;
    const segments = [];
    for (let i = 1; i < tesselationParameters.length; ++i) {
      const start = vec3_exports.transformMat4(
        vec3_exports.create(),
        vertices[i - 1],
        transform
      );
      const end = vec3_exports.transformMat4(vec3_exports.create(), vertices[i], transform);
      const dir = vec3_exports.sub(vec3_exports.create(), end, start);
      vec3_exports.normalize(dir, dir);
      segments.push({ start, end, dir });
    }
    return segments;
  }
  toProfile(transform) {
    const { vertices, tesselationParameters } = this;
    return getProfile(vertices, tesselationParameters, transform);
  }
};
var Line3D = class extends DisposableCurve {
  constructor(origin2, direction2, beginParam, endParam, sense, tesselationParameters) {
    super();
    this.origin = origin2;
    this.direction = direction2;
    this.beginParam = beginParam;
    this.endParam = endParam;
    this.sense = sense;
    this.tesselationParameters = tesselationParameters;
  }
  kind = "line";
  eval(t, point, tangent) {
    const { origin: origin2, direction: direction2, sense, beginParam, endParam } = this;
    if (point) {
      vec3_exports.scale(point, direction2, t);
      vec3_exports.add(point, point, origin2);
    }
    if (tangent) {
      if (sense > 0)
        vec3_exports.copy(tangent, direction2);
      else
        vec3_exports.negate(tangent, direction2);
    }
  }
  invert(pos) {
    const start = vec3_exports.create();
    this.eval(this.beginParam, start, void 0);
    const end = vec3_exports.create();
    this.eval(this.endParam, end, void 0);
    const len4 = vec3_exports.dist(start, end);
    const pointToStart = vec3_exports.create();
    vec3_exports.subtract(pointToStart, pos, start);
    const distAlongLine = vec3_exports.dot(this.direction, pointToStart);
    const fraction = distAlongLine / len4;
    return this.beginParam + (this.endParam - this.beginParam) * fraction;
  }
};
var Arc3D = class extends DisposableCurve {
  constructor(origin2, axisX, axisY, radius, beginParam, endParam, sense, tesselationParameters) {
    super();
    this.origin = origin2;
    this.axisX = axisX;
    this.axisY = axisY;
    this.radius = radius;
    this.beginParam = beginParam;
    this.endParam = endParam;
    this.sense = sense;
    this.tesselationParameters = tesselationParameters;
  }
  kind = "arc";
  tmp = vec3_exports.create();
  eval(t, point, tangent) {
    const { sense } = this;
    const x = Math.cos(t);
    const y = Math.sin(t);
    if (point) {
      const { origin: origin2, radius, axisX, axisY, tmp } = this;
      vec3_exports.scale(tmp, axisX, x * radius);
      vec3_exports.add(point, origin2, tmp);
      vec3_exports.scale(tmp, axisY, y * radius);
      vec3_exports.add(point, point, tmp);
    }
    if (tangent) {
      const { axisX, axisY, tmp } = this;
      vec3_exports.scale(tangent, axisX, x * sense);
      vec3_exports.scale(tmp, axisY, -y * sense);
      vec3_exports.add(tangent, tmp, tangent);
    }
  }
  invert(pos) {
    const a = pointAtAngle(pos, this);
    if (a > this.endParam || a < this.beginParam) {
      let disEnd = a - this.endParam;
      if (disEnd < 0) {
        disEnd += 2 * Math.PI;
      }
      let disStart = this.beginParam - a;
      if (disStart < 0) {
        disStart += 2 * Math.PI;
      }
      if (disEnd < disStart) {
        return this.endParam;
      }
      return this.beginParam;
    }
    return a;
  }
};
function pointAtAngle(point, arc3d) {
  const planeNormal = vec3_exports.cross(vec3_exports.create(), arc3d.axisX, arc3d.axisY);
  const p = vec3_exports.sub(vec3_exports.create(), point, arc3d.origin);
  const d = vec3_exports.dot(p, planeNormal);
  const projectedPoint2 = vec3_exports.scaleAndAdd(
    vec3_exports.create(),
    point,
    planeNormal,
    -d
  );
  const dir = vec3_exports.sub(vec3_exports.create(), projectedPoint2, arc3d.origin);
  vec3_exports.normalize(dir, dir);
  const pointOnArc = vec3_exports.scaleAndAdd(
    vec3_exports.create(),
    arc3d.origin,
    dir,
    arc3d.radius
  );
  vec3_exports.sub(pointOnArc, pointOnArc, arc3d.origin);
  const x = vec3_exports.dot(pointOnArc, arc3d.axisX);
  const y = vec3_exports.dot(pointOnArc, arc3d.axisY);
  let a = Math.atan2(y, x);
  if (a < 0) {
    a += 2 * Math.PI;
  }
  return a;
}
var NurbsCurve3D = class extends DisposableCurve {
  constructor(order, controlPoints, knots, weights, beginParam, endParam, sense, tesselationParameters, wasmInstance, buffer) {
    super();
    this.order = order;
    this.controlPoints = controlPoints;
    this.knots = knots;
    this.weights = weights;
    this.beginParam = beginParam;
    this.endParam = endParam;
    this.sense = sense;
    this.tesselationParameters = tesselationParameters;
    this.wasmInstance = wasmInstance;
    this.buffer = buffer;
  }
  kind = "nurbs";
  ptr = 0;
  dispose() {
    if (this.weights) {
      this.wasmInstance._disposeNurbsCurve3DWithWeights(this.ptr);
    } else {
      this.wasmInstance._disposeNurbsCurve3D(this.ptr);
    }
  }
  eval(t, point, tangent) {
    if (this.ptr === 0) {
      this.ptr = makeNurbsCurve3D(
        this.wasmInstance,
        this.knots,
        this.controlPoints,
        this.weights,
        this.order
      );
    }
    if (this.weights) {
      this.wasmInstance._evalNurbsCurve3DWithWeights(
        this.ptr,
        t,
        point ? this.buffer.byteOffset : void 0,
        tangent ? this.buffer.byteOffset + 24 : void 0
      );
    } else {
      this.wasmInstance._evalNurbsCurve3D(
        this.ptr,
        t,
        point ? this.buffer.byteOffset : void 0,
        tangent ? this.buffer.byteOffset + 24 : void 0
      );
    }
    if (point != void 0) {
      const [x, y, z] = this.buffer.subarray(0, 3);
      vec3_exports.set(point, x, y, z);
    }
    if (tangent != void 0) {
      const [x, y, z] = this.buffer.subarray(3, 6);
      vec3_exports.set(tangent, x, y, z);
    }
  }
  invert(point) {
    if (this.ptr === 0) {
      const ctrlPt2d = this.controlPoints.map(
        (p) => vec2_exports.fromValues(p[0] / Math.PI, p[1] / 500)
      );
      this.ptr = makeNurbsCurve2D(
        this.wasmInstance,
        this.knots,
        ctrlPt2d,
        this.weights,
        this.order
      );
    }
    return this.wasmInstance._invertNurbsCurve3D(
      this.ptr,
      point[0],
      point[1],
      point[2]
    );
  }
};
var Line2D = class extends DisposableCurve {
  constructor(origin2, direction2, beginParam, endParam, sense) {
    super();
    this.origin = origin2;
    this.direction = direction2;
    this.beginParam = beginParam;
    this.endParam = endParam;
    this.sense = sense;
  }
  kind = "line";
  eval(t, point, tangent) {
    const { origin: origin2, direction: direction2 } = this;
    if (point) {
      vec2_exports.scale(point, direction2, t);
      vec2_exports.add(point, point, origin2);
    }
    if (tangent) {
      if (this.sense > 0) {
        vec2_exports.copy(tangent, direction2);
      } else {
        vec2_exports.negate(tangent, direction2);
      }
    }
  }
  project(point) {
    const [x, y] = point;
    const { origin: origin2, direction: direction2, beginParam, endParam } = this;
    const dx = x - origin2[0];
    const dy = y - origin2[1];
    let t = dx * direction2[0] + dy * direction2[1];
    const centerParam = (beginParam + endParam) / 2;
    const extent = Math.abs(endParam - beginParam) / 2;
    const minParam = centerParam - extent;
    const maxParam = centerParam + extent;
    t = Math.max(minParam, Math.min(maxParam, t));
    return t;
  }
  // intersectCount(point: ReadonlyVec2) {
  //     const [x, y] = point;
  //     if (x > this.minX && y >= this.minY && y < this.maxY) {
  //         const { begin, end } = this;
  //         const t = (y - begin[1]) / (end[1] - begin[1]);
  //         const lx = begin[0] + this.deltaX * t;
  //         if (x > lx) {
  //             return 1;
  //         }
  //     }
  //     return 0;
  // }
};
var NurbsCurve2D = class extends DisposableCurve {
  constructor(order, controlPoints, knots, weights, beginParam, endParam, sense, wasmInstance, buffer) {
    super();
    this.order = order;
    this.controlPoints = controlPoints;
    this.knots = knots;
    this.weights = weights;
    this.beginParam = beginParam;
    this.endParam = endParam;
    this.sense = sense;
    this.wasmInstance = wasmInstance;
    this.buffer = buffer;
  }
  kind = "nurbs";
  ptr = 0;
  eval(t, point, tangent) {
    if (this.ptr === 0) {
      const ctrlPt2d = this.controlPoints.map(
        (p) => vec2_exports.fromValues(p[0] / Math.PI, p[1] / 500)
      );
      this.ptr = makeNurbsCurve2D(
        this.wasmInstance,
        this.knots,
        ctrlPt2d,
        this.weights,
        this.order
      );
    }
    if (this.weights) {
      this.wasmInstance._evalNurbsCurve2DWithWeights(
        this.ptr,
        t,
        point ? this.buffer.byteOffset : void 0,
        tangent ? this.buffer.byteOffset + 24 : void 0
      );
    } else {
      this.wasmInstance._evalNurbsCurve2D(
        this.ptr,
        t,
        point ? this.buffer.byteOffset : void 0,
        tangent ? this.buffer.byteOffset + 24 : void 0
      );
    }
    if (point != void 0) {
      const [x, y] = this.buffer.subarray(0, 2);
      vec2_exports.set(point, x, y);
    }
    if (tangent != void 0) {
      const [x, y] = this.buffer.subarray(3, 5);
      vec2_exports.set(tangent, x, y);
    }
  }
  project(point) {
    if (this.ptr === 0) {
      const ctrlPt2d = this.controlPoints.map(
        (p) => vec2_exports.fromValues(p[0] / Math.PI, p[1] / 500)
      );
      this.ptr = makeNurbsCurve2D(
        this.wasmInstance,
        this.knots,
        ctrlPt2d,
        this.weights,
        this.order
      );
    }
    return this.wasmInstance._projectNurbsCurve2D(this.ptr, point[0], point[1]);
  }
  dispose() {
    if (this.weights) {
      this.wasmInstance._disposeNurbsCurve2DWithWeights(this.ptr);
    } else {
      this.wasmInstance._disposeNurbsCurve2D(this.ptr);
    }
  }
};
var pi2 = Math.PI * 2;
var Arc2D = class {
  constructor(origin2, radius, beginParam, endParam, sense) {
    this.origin = origin2;
    this.radius = radius;
    this.beginParam = beginParam;
    this.endParam = endParam;
    this.sense = sense;
  }
  kind = "arc";
  eval(t, point, tangent) {
    const x = Math.cos(t);
    const y = Math.sin(t);
    if (point) {
      const { origin: origin2, radius } = this;
      point[0] = x * radius + origin2[0];
      point[1] = y * radius + origin2[1];
    }
    if (tangent) {
      const { sense } = this;
      tangent[0] = -y * sense;
      tangent[1] = x * sense;
    }
  }
  project(point) {
    const [x, y] = point;
    const { origin: origin2, beginParam, endParam } = this;
    let t = Math.atan2(y - origin2[1], x - origin2[0]);
    if (t < 0)
      t += pi2;
    const centerParam = (beginParam + endParam) / 2;
    const extent = Math.abs(endParam - beginParam) / 2;
    const minParam = centerParam - extent;
    const maxParam = centerParam + extent;
    while (t < centerParam - Math.PI)
      t += pi2;
    while (t > centerParam + Math.PI)
      t -= pi2;
    t = Math.max(minParam, Math.min(maxParam, t));
    return t;
  }
  // isVectorInParamRange(x: number, y: number) {
  //     return x * this.rangeVec[0] + y * this.rangeVec[1] >= this.rangeCos;
  // }
  // intersectCount(point: ReadonlyVec2) {
  //     const [x, y] = point;
  //     const { origin, radius } = this;
  //     let cnt = 0;
  //     if (y >= this.minY && y < this.maxY) {
  //         const uy = Math.min(1, (y - origin[1]) / radius);
  //         const ux = Math.sqrt(1 - uy * uy);
  //         // is point right of origin?
  //         if (x > origin[0]) {
  //             if (this.isVectorInParamRange(ux, uy) && x > ux) {
  //                 cnt++;
  //             }
  //         }
  //         if (x > origin[0] - radius) {
  //             if (this.isVectorInParamRange(-ux, uy) && x > -ux) {
  //                 cnt++;
  //             }
  //         }
  //     }
  //     return cnt;
  // }
};

// /projects/Novorender/ts/dist/measure/worker/calculations.ts
common_exports.setMatrixArrayType(Array);
var epsilon = 1e-4;
function isInsideAABB(point, aabb, epsilon4 = 0) {
  for (let i = 0; i < 3; ++i) {
    if (point[i] - aabb.min[i] + epsilon4 < 0 || aabb.max[i] - point[i] + epsilon4 < 0) {
      return false;
    }
  }
  return true;
}
function cylinderLength(product, cylinderFace, origo, dir) {
  const loopData = product.loops[cylinderFace.outerLoop];
  const circleOrigins = [];
  for (const halfEdge of loopData.halfEdges) {
    const halfEdgeData = product.halfEdges[halfEdge];
    const edgeData = product.edges[halfEdgeData.edge];
    if (edgeData.curve3D !== void 0) {
      const curveData = product.curves3D[edgeData.curve3D];
      if (curveData.kind == "circle") {
        circleOrigins.push(curveData.origin);
      }
    }
  }
  if (circleOrigins.length == 2) {
    let sense = 1;
    const other = vec3_exports.equals(circleOrigins[0], origo) ? circleOrigins[1] : circleOrigins[0];
    if (vec3_exports.dot(dir, vec3_exports.sub(vec3_exports.create(), other, origo)) < 0) {
      sense = -1;
    }
    return sense * vec3_exports.dist(circleOrigins[0], circleOrigins[1]);
  }
  return 0;
}
function fullCircle(edge) {
  const paramLength = Math.abs(
    edge.parameterBounds[1] - edge.parameterBounds[0]
  );
  return Math.abs(paramLength - 2 * Math.PI) < epsilon;
}
function fullCircleCylinder(product, cylinderFace) {
  const loopData = product.loops[cylinderFace.outerLoop];
  const halfEdges = loopData.halfEdges.map((i) => product.halfEdges[i]);
  let noArcs = 0;
  for (const halfEdge of halfEdges) {
    const edge = product.edges[halfEdge.edge];
    if (edge.curve3D !== void 0) {
      const curve = product.curves3D[edge.curve3D];
      if (curve.kind == "circle") {
        noArcs++;
        if (!fullCircle(edge)) {
          return false;
        }
      }
    }
  }
  return noArcs == 2;
}
async function cylinderCenterLine(product, cylinderFace, cylinderData, instanceMat, measureType) {
  const scale6 = unitToScale(product.units);
  const cylinderMtx = mat4_exports.fromValues(
    ...cylinderData.transform
  );
  const cylinderOrigo = mat4_exports.getTranslation(vec3_exports.create(), cylinderMtx);
  const cylinderDir = vec3_exports.fromValues(
    cylinderMtx[8],
    cylinderMtx[9],
    cylinderMtx[10]
  );
  const cyliderLen = cylinderLength(
    product,
    cylinderFace,
    cylinderOrigo,
    cylinderDir
  );
  const cylinderEnd = vec3_exports.add(
    vec3_exports.create(),
    cylinderOrigo,
    vec3_exports.scale(vec3_exports.create(), cylinderDir, cyliderLen)
  );
  vec3_exports.transformMat4(cylinderOrigo, cylinderOrigo, instanceMat);
  vec3_exports.transformMat4(cylinderEnd, cylinderEnd, instanceMat);
  if (measureType == "bottom" || measureType == "top") {
    const dir = vec3_exports.sub(vec3_exports.create(), cylinderEnd, cylinderOrigo);
    vec3_exports.normalize(dir, dir);
    const up = common_exports.equals(
      Math.abs(vec3_exports.dot(vec3_exports.fromValues(0, 0, 1), dir)),
      1
    ) ? vec3_exports.fromValues(0, 1, 0) : vec3_exports.fromValues(0, 0, 1);
    const right = vec3_exports.cross(vec3_exports.create(), up, dir);
    vec3_exports.cross(up, dir, right);
    vec3_exports.normalize(up, up);
    if (measureType == "top") {
      vec3_exports.scaleAndAdd(cylinderOrigo, cylinderOrigo, up, cylinderData.radius * scale6);
      vec3_exports.scaleAndAdd(cylinderEnd, cylinderEnd, up, cylinderData.radius * scale6);
    } else {
      vec3_exports.scaleAndAdd(cylinderOrigo, cylinderOrigo, up, -cylinderData.radius * scale6);
      vec3_exports.scaleAndAdd(cylinderEnd, cylinderEnd, up, -cylinderData.radius * scale6);
    }
  }
  return [cylinderOrigo, cylinderEnd];
}
function closestPointsToIntersection(startA, endA, startB, endB) {
  const dirA = vec3_exports.sub(vec3_exports.create(), endA, startA);
  const lenA = vec3_exports.len(dirA);
  vec3_exports.normalize(dirA, dirA);
  const dirB = vec3_exports.sub(vec3_exports.create(), endB, startB);
  vec3_exports.normalize(dirB, dirB);
  const dp = vec3_exports.dot(dirA, dirB);
  const cp = vec3_exports.len(vec3_exports.cross(vec3_exports.create(), dirA, dirB));
  function intersectionPoint(a, da, p, l) {
    const ab = vec3_exports.sub(vec3_exports.create(), p, a);
    const ta = vec3_exports.dot(ab, da);
    const pa = vec3_exports.scaleAndAdd(vec3_exports.create(), a, da, ta);
    const d = vec3_exports.dist(pa, p);
    const tb = d * dp / cp;
    const t = Math.min(l, Math.max(ta + tb, 0));
    return vec3_exports.scaleAndAdd(vec3_exports.create(), a, da, t);
  }
  return intersectionPoint(startA, dirA, startB, lenA);
}
function closestProjectedPoints(startA, endA, startB, endB) {
  let pointA = vec3_exports.create();
  let pointB = vec3_exports.create();
  const { pos: p1 } = closestPointToLine(startB, startA, endA);
  const { pos: p2 } = closestPointToLine(endB, startA, endA);
  const { pos: p3 } = closestPointToLine(startA, startB, endB);
  const { pos: p4 } = closestPointToLine(endA, startB, endB);
  const d1 = vec3_exports.length(vec3_exports.sub(vec3_exports.create(), startB, p1));
  const d2 = vec3_exports.length(vec3_exports.sub(vec3_exports.create(), p2, endB));
  const d3 = vec3_exports.length(vec3_exports.sub(vec3_exports.create(), startA, p3));
  const d4 = vec3_exports.length(vec3_exports.sub(vec3_exports.create(), p4, endA));
  let pointChosen = "a";
  let distance4 = 0;
  if (d1 < d2 && d1 < d3 && d1 < d4) {
    distance4 = d1;
    pointA = p1;
    pointB = startB;
  } else if (d2 < d3 && d2 < d4) {
    distance4 = d2;
    pointA = p2;
    pointB = endB;
  } else if (d3 < d4) {
    distance4 = d3;
    pointA = startA;
    pointB = p3;
    pointChosen = "b";
  } else {
    distance4 = d3;
    pointA = endA;
    pointB = p4;
    pointChosen = "b";
  }
  if (pointChosen == "a") {
    const { pos: p5 } = closestPointToLine(pointA, startB, endB);
    const testDist = vec3_exports.dist(p5, pointA);
    if (testDist < distance4) {
      pointB = p5;
      distance4 = testDist;
    }
  } else {
    const { pos: p5 } = closestPointToLine(pointB, startA, endA);
    const testDist = vec3_exports.dist(p5, pointB);
    if (testDist < distance4) {
      pointA = p5;
      distance4 = testDist;
    }
  }
  return [distance4, pointA, pointB];
}
function decomposePlane(product, faceData, instanceIdx, plane, centerPoint = false) {
  const mat = matFromInstance(product.instances[instanceIdx]);
  const normalMat = mat3_exports.normalFromMat4(mat3_exports.create(), mat);
  const uv = vec2_exports.fromValues(0, 0);
  const planePoint = vec3_exports.create();
  const planeNorm = vec3_exports.create();
  if (centerPoint) {
    vec3_exports.add(planePoint, faceData.aabb.max, faceData.aabb.min);
    vec3_exports.scale(planePoint, planePoint, 0.5);
  } else {
    plane.evalPosition(planePoint, uv);
  }
  plane.evalNormal(planeNorm, uv);
  vec3_exports.transformMat4(planePoint, planePoint, mat);
  vec3_exports.transformMat3(planeNorm, planeNorm, normalMat);
  vec3_exports.normalize(planeNorm, planeNorm);
  return [planePoint, planeNorm];
}
function lineToLineMeasure(segA, segB) {
  const parallel = vec3_exports.equals(segA.dir, segB.dir) || vec3_exports.equals(segA.dir, vec3_exports.negate(segB.dir, segB.dir));
  let [distance4, pointA, pointB] = closestProjectedPoints(
    segA.start,
    segA.end,
    segB.start,
    segB.end
  );
  const diff = vec3_exports.sub(vec3_exports.create(), pointA, pointB);
  if (!parallel) {
    const crossPoint = closestPointsToIntersection(
      segA.start,
      segA.end,
      segB.start,
      segB.end
    );
    const { pos: crossPointA } = closestPointToLine(
      crossPoint,
      segA.start,
      segA.end
    );
    const { pos: crossPointB } = closestPointToLine(
      crossPoint,
      segB.start,
      segB.end
    );
    if (distance4 > vec3_exports.dist(crossPointA, crossPointB)) {
      pointA = crossPointA;
      pointB = crossPointB;
      vec3_exports.sub(diff, crossPointB, crossPointA);
    }
  }
  return {
    drawKind: "measureResult",
    distance: vec3_exports.len(diff),
    distanceX: Math.abs(diff[0]),
    distanceY: Math.abs(diff[1]),
    distanceZ: Math.abs(diff[2]),
    measureInfoA: { point: pointA },
    measureInfoB: { point: pointB }
  };
}
function toMeasureValues(pointA, pointB, parameterA, parameterB) {
  const diff = vec3_exports.subtract(vec3_exports.create(), pointA, pointB);
  return {
    drawKind: "measureResult",
    distance: vec3_exports.len(diff),
    distanceX: Math.abs(diff[0]),
    distanceY: Math.abs(diff[1]),
    distanceZ: Math.abs(diff[2]),
    measureInfoA: { point: pointA, parameter: parameterA },
    measureInfoB: { point: pointB, parameter: parameterB }
  };
}
function segmentToArcMeasure(arc, arcMat, seg) {
  const wsOrigin = vec3_exports.transformMat4(vec3_exports.create(), arc.origin, arcMat);
  const { pos: point } = closestPointToLine(wsOrigin, seg.start, seg.end);
  const arcInvMat = mat4_exports.invert(mat4_exports.create(), arcMat);
  const pointInArcSpace = vec3_exports.transformMat4(vec3_exports.create(), point, arcInvMat);
  const t = pointAtAngle(pointInArcSpace, arc);
  const pointA = vec3_exports.create();
  const pointB = vec3_exports.create();
  if (t <= arc.endParam && t >= arc.beginParam) {
    arc.eval(t, pointA, void 0);
    vec3_exports.transformMat4(pointA, pointA, arcMat);
    vec3_exports.copy(pointB, point);
  } else {
    const arcPointA = vec3_exports.create();
    arc.eval(arc.beginParam, arcPointA, void 0);
    vec3_exports.transformMat4(arcPointA, arcPointA, arcMat);
    const arcPointB = vec3_exports.create();
    arc.eval(arc.endParam, arcPointB, void 0);
    vec3_exports.transformMat4(arcPointB, arcPointB, arcMat);
    const { pos: linePointA } = closestPointToLine(
      arcPointA,
      seg.start,
      seg.end
    );
    const { pos: linePointB } = closestPointToLine(
      arcPointB,
      seg.start,
      seg.end
    );
    const da = vec3_exports.dist(linePointA, arcPointA);
    const db = vec3_exports.dist(linePointB, arcPointB);
    if (da < db) {
      vec3_exports.copy(pointA, arcPointA);
      vec3_exports.copy(pointB, linePointA);
    } else {
      vec3_exports.copy(pointA, arcPointB);
      vec3_exports.copy(pointB, linePointB);
    }
  }
  return toMeasureValues(pointA, pointB);
}
function closestPointToArc(point, arc, mat) {
  const invMat = mat4_exports.invert(mat4_exports.create(), mat);
  const localSpaceP = vec3_exports.transformMat4(vec3_exports.create(), point, invMat);
  const t = arc.invert(localSpaceP);
  const pointOnCircle = vec3_exports.create();
  arc.eval(t, pointOnCircle, void 0);
  vec3_exports.transformMat4(pointOnCircle, pointOnCircle, mat);
  return pointOnCircle;
}
function getCurveToCurveMeasureValues(productA, curveA, instanceIdxA, productB, curveB, instanceIdxB) {
  let curveDataA = { product: productA, curve: curveA, instance: instanceIdxA };
  let curveDataB = { product: productB, curve: curveB, instance: instanceIdxB };
  const entities = [curveDataA, curveDataB];
  entities.sort((a, b) => a.curve.kind.localeCompare(b.curve.kind));
  [curveDataA, curveDataB] = entities;
  const kindCombo = `${curveDataA.curve.kind}_${curveDataB.curve.kind}`;
  const matA = matFromInstance(
    curveDataA.product.instances[curveDataA.instance]
  );
  const matB = matFromInstance(
    curveDataB.product.instances[curveDataB.instance]
  );
  switch (kindCombo) {
    case "line_line": {
      const values = lineToLineMeasure(
        lineToSegment(curveDataA.curve, matA),
        lineToSegment(curveDataB.curve, matB)
      );
      return values;
    }
    case "arc_arc": {
      const arcA = curveDataA.curve;
      const arcB = curveDataB.curve;
      const wsOriginA = vec3_exports.transformMat4(vec3_exports.create(), arcA.origin, matA);
      const wsOriginB = vec3_exports.transformMat4(vec3_exports.create(), arcB.origin, matB);
      const closestPointA = closestPointToArc(wsOriginA, arcB, matB);
      const closestPointB = closestPointToArc(wsOriginB, arcA, matA);
      return toMeasureValues(closestPointA, closestPointB);
    }
    case "arc_line": {
      const arc = curveDataA.curve;
      const line = curveDataB.curve;
      return segmentToArcMeasure(arc, matA, lineToSegment(line, matA));
    }
    case "arc_lineStrip": {
      const arc = curveDataA.curve;
      const strip = curveDataB.curve;
      const segments = strip.toSegments(matB);
      let minDist = 1e6;
      let bestMeasureValues = void 0;
      for (const seg of segments) {
        const measureValue = segmentToArcMeasure(arc, matA, seg);
        if (measureValue.distance && measureValue.distance < minDist) {
          bestMeasureValues = measureValue;
          minDist = measureValue.distance;
        }
      }
      return bestMeasureValues;
    }
    case "line_lineStrip": {
      const segmentA = lineToSegment(curveDataA.curve, matA);
      const strip = curveDataB.curve;
      const segments = strip.toSegments(matB);
      let minDist = 1e6;
      let bestMeasureValues = void 0;
      for (const seg of segments) {
        const measureValue = lineToLineMeasure(segmentA, seg);
        if (measureValue.distance && measureValue.distance < minDist) {
          bestMeasureValues = measureValue;
          minDist = measureValue.distance;
        }
      }
      if (bestMeasureValues && bestMeasureValues.measureInfoA?.point && bestMeasureValues.measureInfoB?.point) {
        const tb = strip.invert(bestMeasureValues.measureInfoB.point);
        return { ...bestMeasureValues, measureInfoB: { point: bestMeasureValues.measureInfoB.point, parameter: tb } };
      }
    }
    case "lineStrip_lineStrip": {
      const stripA = curveDataA.curve;
      const segmentsA = stripA.toSegments(matA);
      const stripB = curveDataB.curve;
      const segmentsB = stripB.toSegments(matB);
      let minDist = 1e6;
      let bestMeasureValues = void 0;
      for (const segA of segmentsA) {
        for (const segB of segmentsB) {
          const measureValue = lineToLineMeasure(segA, segB);
          if (measureValue.distance && measureValue.distance < minDist) {
            bestMeasureValues = measureValue;
            minDist = measureValue.distance;
          }
        }
      }
      if (bestMeasureValues && bestMeasureValues.measureInfoA?.point && bestMeasureValues.measureInfoB?.point) {
        const ta = stripA.invert(bestMeasureValues.measureInfoA.point);
        const tb = stripB.invert(bestMeasureValues.measureInfoB.point);
        return { ...bestMeasureValues, measureInfoA: { point: bestMeasureValues.measureInfoA.point, parameter: ta }, measureInfoB: { point: bestMeasureValues.measureInfoB.point, parameter: tb } };
      }
      return bestMeasureValues;
    }
  }
}
async function getEdgeToEdgeMeasureValues(productA, edgeIdxA, instanceIdxA, productB, edgeIdxB, instanceIdxB) {
  let edgeCurveA = MeasureTool.geometryFactory.getCurve3DFromEdge(
    productA,
    edgeIdxA
  );
  let edgeCurveB = MeasureTool.geometryFactory.getCurve3DFromEdge(
    productB,
    edgeIdxB
  );
  if (edgeCurveA && edgeCurveB) {
    return getCurveToCurveMeasureValues(
      productA,
      edgeCurveA,
      instanceIdxA,
      productB,
      edgeCurveB,
      instanceIdxB
    );
  }
}
async function faceToPointMeasureValues(product, faceIdx, instanceIdx, point, scale6, setting) {
  const faceData = product.faces[faceIdx];
  const surfaceData = product.surfaces[faceData.surface];
  const surface = MeasureTool.geometryFactory.getSurface(surfaceData, 1);
  if (surface) {
    const mat = matFromInstance(product.instances[instanceIdx]);
    switch (surface.kind) {
      case "plane": {
        const [pointPlane, norm] = decomposePlane(
          product,
          faceData,
          instanceIdx,
          surface,
          false
        );
        const d = vec3_exports.dot(
          norm,
          vec3_exports.subtract(vec3_exports.create(), point, pointPlane)
        );
        const normalPoint = vec3_exports.add(
          vec3_exports.create(),
          point,
          vec3_exports.scale(vec3_exports.create(), vec3_exports.negate(vec3_exports.create(), norm), d)
        );
        return {
          drawKind: "measureResult",
          normalDistance: Math.abs(d),
          distanceX: 0,
          distanceY: 0,
          distanceZ: 0,
          normalPoints: [point, normalPoint]
        };
      }
      case "cylinder": {
        const cylinderMeasure = setting ? setting.cylinderMeasure : "center";
        const cylinder = surfaceData;
        const [cylinderOrigo, cylinderEnd] = await cylinderCenterLine(
          product,
          faceData,
          cylinder,
          mat,
          cylinderMeasure
        );
        const projectedPoint2 = vec3_exports.create();
        const { pos: p1 } = closestPointToLine(
          point,
          cylinderOrigo,
          cylinderEnd,
          projectedPoint2
        );
        const diff = vec3_exports.sub(vec3_exports.create(), point, p1);
        const canUseCylinderSettings = vec3_exports.equals(projectedPoint2, p1) && fullCircleCylinder(product, faceData);
        if ((cylinderMeasure == "closest" || cylinderMeasure == "furthest") && canUseCylinderSettings) {
          vec3_exports.normalize(diff, diff);
          vec3_exports.scale(diff, diff, cylinder.radius * scale6);
          if (cylinderMeasure == "closest") {
            vec3_exports.add(p1, p1, diff);
          } else {
            vec3_exports.sub(p1, p1, diff);
          }
          vec3_exports.sub(diff, point, p1);
        }
        return {
          drawKind: "measureResult",
          distance: vec3_exports.length(diff),
          distanceX: Math.abs(diff[0]),
          distanceY: Math.abs(diff[1]),
          distanceZ: Math.abs(diff[2]),
          measureInfoA: { point, validMeasureSettings: canUseCylinderSettings },
          measureInfoB: { point: p1, validMeasureSettings: canUseCylinderSettings }
        };
      }
    }
  }
}
function curveToPointMeasureValues(product, curve, instanceIdx, point) {
  const mat = matFromInstance(product.instances[instanceIdx]);
  if (curve.kind == "line") {
    const line = curve;
    const start = vec3_exports.create();
    const end = vec3_exports.create();
    const dir = vec3_exports.create();
    curve.eval(line.beginParam, start, dir);
    curve.eval(line.endParam, end, void 0);
    vec3_exports.transformMat4(start, start, mat);
    vec3_exports.transformMat4(end, end, mat);
    const projectedPoint2 = vec3_exports.create();
    const { pos: closestPointOnLine } = closestPointToLine(
      point,
      start,
      end,
      projectedPoint2
    );
    return toMeasureValues(point, closestPointOnLine);
  } else if (curve.kind == "arc") {
    const closestPoint = closestPointToArc(point, curve, mat);
    return toMeasureValues(point, closestPoint);
  } else if (curve.kind == "lineStrip") {
    const invMat = mat4_exports.invert(mat4_exports.create(), mat);
    const localSpaceP = vec3_exports.transformMat4(vec3_exports.create(), point, invMat);
    const t = curve.invert(localSpaceP);
    const closestPoint = vec3_exports.create();
    curve.eval(t, closestPoint, void 0);
    vec3_exports.transformMat4(closestPoint, closestPoint, mat);
    return toMeasureValues(point, closestPoint, void 0, t);
  }
}
async function edgeToPointMeasureValues(product, edgeIdx, instanceIdx, point) {
  const curve = MeasureTool.geometryFactory.getCurve3DFromEdge(product, edgeIdx);
  if (curve) {
    return curveToPointMeasureValues(product, curve, instanceIdx, point);
  }
}
async function segmentToPointMeasureValues(product, segIdx, instanceIdx, point) {
  const curve = MeasureTool.geometryFactory.getCurve3DFromSegment(product, segIdx);
  if (curve) {
    return curveToPointMeasureValues(product, curve, instanceIdx, point);
  }
}
function lineToPlaneMeasure(lineSegment, plane, planeProduct, planeFacedata, faceInstance) {
  const [planePoint, planeNorm] = decomposePlane(
    planeProduct,
    planeFacedata,
    faceInstance,
    plane
  );
  const lineLength = vec3_exports.dist(lineSegment.start, lineSegment.end);
  const linePoint = vec3_exports.scaleAndAdd(
    vec3_exports.create(),
    lineSegment.start,
    lineSegment.dir,
    lineLength
  );
  const parallel = Math.abs(vec3_exports.dot(lineSegment.dir, planeNorm)) < 1e-3;
  if (parallel) {
    const d1 = vec3_exports.dot(planeNorm, planePoint);
    const d2 = vec3_exports.dot(planeNorm, linePoint);
    const d = d1 - d2;
    const normalPointFromLine = vec3_exports.add(
      vec3_exports.create(),
      linePoint,
      vec3_exports.scale(vec3_exports.create(), planeNorm, d)
    );
    return {
      drawKind: "measureResult",
      distance: Math.abs(d),
      distanceX: 0,
      distanceY: 0,
      distanceZ: 0,
      normalPoints: [normalPointFromLine, linePoint]
    };
  }
}
async function lineToCylinderMeasure(seg, cylinder, cylinderProduct, cylinderFaceData, cylinderMat, cylinderScale, cylinderMeasure) {
  const [cylinderOrigo, cylinderEnd] = await cylinderCenterLine(
    cylinderProduct,
    cylinderFaceData,
    cylinder,
    cylinderMat,
    cylinderMeasure
  );
  const cylinderDir = vec3_exports.sub(vec3_exports.create(), cylinderEnd, cylinderOrigo);
  vec3_exports.normalize(cylinderDir, cylinderDir);
  const parallel = vec3_exports.equals(cylinderDir, seg.dir) || vec3_exports.equals(cylinderDir, vec3_exports.negate(vec3_exports.create(), seg.dir));
  const [distance4, pointA, pointB] = closestProjectedPoints(
    cylinderOrigo,
    cylinderEnd,
    seg.start,
    seg.end
  );
  if (!parallel) {
    const crossPoint = closestPointsToIntersection(
      cylinderOrigo,
      cylinderEnd,
      seg.start,
      seg.end
    );
    const { pos: crossPointA } = closestPointToLine(
      crossPoint,
      cylinderOrigo,
      cylinderEnd
    );
    const { pos: crossPointB } = closestPointToLine(
      crossPoint,
      seg.start,
      seg.end
    );
    if (distance4 > vec3_exports.dist(crossPointA, crossPointB)) {
      vec3_exports.copy(pointA, crossPointA);
      vec3_exports.copy(pointB, crossPointB);
    }
  }
  const diff = vec3_exports.sub(vec3_exports.create(), pointB, pointA);
  const canUseCylinderSettings = parallel && fullCircleCylinder(cylinderProduct, cylinderFaceData);
  if ((cylinderMeasure == "closest" || cylinderMeasure == "furthest") && canUseCylinderSettings) {
    vec3_exports.normalize(diff, diff);
    vec3_exports.scale(diff, diff, cylinder.radius * cylinderScale);
    if (cylinderMeasure == "closest") {
      vec3_exports.add(pointA, pointA, diff);
    } else {
      vec3_exports.sub(pointA, pointA, diff);
    }
    vec3_exports.sub(diff, pointB, pointA);
  }
  return {
    drawKind: "measureResult",
    distance: vec3_exports.length(diff),
    distanceX: Math.abs(diff[0]),
    distanceY: Math.abs(diff[1]),
    distanceZ: Math.abs(diff[2]),
    measureInfoA: { point: pointA, validMeasureSettings: canUseCylinderSettings },
    measureInfoB: { point: pointB, validMeasureSettings: canUseCylinderSettings }
  };
}
async function getCurveToSurfaceMeasureValues(curve, productA, curveInstanceIdx, productB, faceIdx, faceInstanceIdx, setting) {
  const faceData = productB.faces[faceIdx];
  const surfaceData = productB.surfaces[faceData.surface];
  const surface = MeasureTool.geometryFactory.getSurface(surfaceData, 1);
  if (surface) {
    const kindCombo = `${curve.kind}_${surface.kind}`;
    switch (kindCombo) {
      case "line_plane": {
        const line = curve;
        const lineMat = matFromInstance(productA.instances[curveInstanceIdx]);
        const plane = surface;
        return lineToPlaneMeasure(
          lineToSegment(line, lineMat),
          plane,
          productB,
          faceData,
          faceInstanceIdx
        );
      }
      case "lineStrip_plane": {
        const stripMat = matFromInstance(productA.instances[curveInstanceIdx]);
        const strip = curve;
        const segments = strip.toSegments(stripMat);
        let minDist = 1e6;
        let bestMeasureValues = void 0;
        const plane = surface;
        for (const seg of segments) {
          const measureValue = lineToPlaneMeasure(
            seg,
            plane,
            productB,
            faceData,
            faceInstanceIdx
          );
          if (measureValue && measureValue.distance && measureValue.distance < minDist) {
            bestMeasureValues = measureValue;
            minDist = measureValue.distance;
          }
        }
        return bestMeasureValues;
      }
      case "line_cylinder": {
        const line = curve;
        const lineMat = matFromInstance(productA.instances[curveInstanceIdx]);
        const cylinder = surfaceData;
        const cylinderMat = matFromInstance(
          productB.instances[faceInstanceIdx]
        );
        return await lineToCylinderMeasure(
          lineToSegment(line, lineMat),
          cylinder,
          productB,
          faceData,
          cylinderMat,
          unitToScale(productB.units),
          setting?.cylinderMeasure ? setting.cylinderMeasure : "center"
        );
      }
      case "lineStrip_cylinder": {
        const stripMat = matFromInstance(productA.instances[curveInstanceIdx]);
        const cylinderMat = matFromInstance(
          productB.instances[faceInstanceIdx]
        );
        const strip = curve;
        const segments = strip.toSegments(stripMat);
        let minDist = 1e6;
        let bestMeasureValues = void 0;
        for (const seg of segments) {
          const measureValue = await lineToCylinderMeasure(
            seg,
            surfaceData,
            productB,
            faceData,
            cylinderMat,
            unitToScale(productB.units),
            setting?.cylinderMeasure ? setting.cylinderMeasure : "center"
          );
          if (measureValue.distance && measureValue.distance < minDist) {
            bestMeasureValues = measureValue;
            minDist = measureValue.distance;
          }
        }
        return bestMeasureValues;
      }
    }
  }
}
async function getEdgeToFaceMeasureValues(productA, edgeIdx, edgeInstanceIdx, productB, faceIdx, faceInstanceIdx, setting) {
  const edgeCurve = MeasureTool.geometryFactory.getCurve3DFromEdge(
    productA,
    edgeIdx
  );
  if (edgeCurve) {
    return getCurveToSurfaceMeasureValues(
      edgeCurve,
      productA,
      edgeInstanceIdx,
      productB,
      faceIdx,
      faceInstanceIdx,
      setting
    );
  }
}
async function getSegmentToFaceMeasureValues(productA, segIdx, segInstanceIdx, productB, faceIdx, faceInstanceIdx, setting) {
  const segCurve = MeasureTool.geometryFactory.getCurve3DFromSegment(
    productA,
    segIdx
  );
  if (segCurve) {
    return getCurveToSurfaceMeasureValues(
      segCurve,
      productA,
      segInstanceIdx,
      productB,
      faceIdx,
      faceInstanceIdx,
      setting
    );
  }
}
function planeToPlaneMeasure(productA, faceDataA, instanceA, planeA, productB, faceDataB, instanceB, planeB) {
  const [pointPlaneA, normA] = decomposePlane(
    productA,
    faceDataA,
    instanceA,
    planeA,
    true
  );
  const [pointPlaneB, normB] = decomposePlane(
    productB,
    faceDataB,
    instanceB,
    planeB
  );
  const dot4 = Math.abs(vec3_exports.dot(normA, normB));
  if (dot4 > 0.999) {
    const d = vec3_exports.dot(
      normA,
      vec3_exports.subtract(vec3_exports.create(), pointPlaneB, pointPlaneA)
    );
    const normalPointB = vec3_exports.add(
      vec3_exports.create(),
      pointPlaneA,
      vec3_exports.scale(vec3_exports.create(), normA, d)
    );
    const normalPointA = vec3_exports.copy(vec3_exports.create(), pointPlaneA);
    return {
      drawKind: "measureResult",
      distance: Math.abs(d),
      distanceX: 0,
      distanceY: 0,
      distanceZ: 0,
      normalPoints: [normalPointA, normalPointB]
    };
  }
}
async function cylinderToCylinderMeasure(cylinderA, matA, productA, faceDataA, scaleA, cylinderB, matB, productB, faceDataB, scaleB, cylinderMeasureA, cylinderMeasureB) {
  const [cylinderOrigoA, cylinderEndA] = await cylinderCenterLine(
    productA,
    faceDataA,
    cylinderA,
    matA,
    cylinderMeasureA
  );
  const dirA = vec3_exports.sub(vec3_exports.create(), cylinderEndA, cylinderOrigoA);
  vec3_exports.normalize(dirA, dirA);
  const [cylinderOrigoB, cylinderEndB] = await cylinderCenterLine(
    productB,
    faceDataB,
    cylinderB,
    matB,
    cylinderMeasureB
  );
  const dirB = vec3_exports.sub(vec3_exports.create(), cylinderEndB, cylinderOrigoB);
  vec3_exports.normalize(dirB, dirB);
  const parallel = vec3_exports.equals(dirA, dirB) || vec3_exports.equals(dirA, vec3_exports.negate(vec3_exports.create(), dirB));
  let [distance4, pointA, pointB] = closestProjectedPoints(
    cylinderOrigoA,
    cylinderEndA,
    cylinderOrigoB,
    cylinderEndB
  );
  const diff = vec3_exports.sub(vec3_exports.create(), pointA, pointB);
  const canUseCylinderSettings = parallel && fullCircleCylinder(productA, faceDataA) && fullCircleCylinder(productB, faceDataB);
  let angle3 = void 0;
  if (!parallel) {
    const intersectionPoint = closestPointsToIntersection(
      cylinderOrigoA,
      cylinderEndA,
      cylinderOrigoB,
      cylinderEndB
    );
    const { pos: crossPointA } = closestPointToLine(
      intersectionPoint,
      cylinderOrigoA,
      cylinderEndA
    );
    const { pos: crossPointB } = closestPointToLine(
      intersectionPoint,
      cylinderOrigoB,
      cylinderEndB
    );
    if (vec3_exports.dist(pointA, pointB) > vec3_exports.dist(crossPointA, crossPointB)) {
      vec3_exports.sub(diff, crossPointB, crossPointA);
      pointA = vec3_exports.clone(crossPointA);
      pointB = vec3_exports.clone(crossPointB);
    }
    if (vec3_exports.length(diff) < 0.5) {
      let negate4 = false;
      if (vec3_exports.dist(pointA, cylinderEndA) < vec3_exports.dist(pointA, cylinderOrigoA)) {
        vec3_exports.negate(dirA, dirA);
      }
      if (vec3_exports.dist(pointB, cylinderEndB) < vec3_exports.dist(pointB, cylinderOrigoB)) {
        negate4 = true;
        vec3_exports.negate(dirB, dirB);
      }
      let radians = vec3_exports.angle(dirA, dirB);
      if (radians > Math.PI) {
        radians = Math.PI * 2 - radians;
      }
      let addAdditionalLine = false;
      if (radians > Math.PI / 2) {
        radians = Math.PI - radians;
        if (negate4) {
          vec3_exports.negate(dirB, dirB);
        } else {
          vec3_exports.negate(dirA, dirA);
        }
        addAdditionalLine = true;
      }
      const center = vec3_exports.add(vec3_exports.create(), pointA, pointB);
      vec3_exports.scale(center, center, 0.5);
      const anglePa = vec3_exports.add(vec3_exports.create(), center, dirA);
      const anglePb = vec3_exports.add(vec3_exports.create(), center, dirB);
      angle3 = {
        radians,
        angleDrawInfo: [center, anglePa, anglePb],
        additionalLine: addAdditionalLine ? [vec3_exports.clone(center), vec3_exports.clone(anglePa)] : void 0
      };
    }
  } else {
    vec3_exports.normalize(diff, diff);
    const radiusDirA = vec3_exports.scale(
      vec3_exports.create(),
      diff,
      cylinderA.radius * scaleA * -1
    );
    const radiusDirB = vec3_exports.scale(
      vec3_exports.create(),
      diff,
      cylinderB.radius * scaleB
    );
    if (cylinderMeasureA == "closest") {
      vec3_exports.add(pointA, pointA, radiusDirA);
    } else if (cylinderMeasureA == "furthest") {
      vec3_exports.sub(pointA, pointA, radiusDirA);
    }
    if (cylinderMeasureB == "closest") {
      vec3_exports.add(pointB, pointB, radiusDirB);
    } else if (cylinderMeasureB == "furthest") {
      vec3_exports.sub(pointB, pointB, radiusDirB);
    }
    vec3_exports.sub(diff, pointB, pointA);
  }
  return {
    drawKind: "measureResult",
    distance: vec3_exports.length(diff),
    distanceX: Math.abs(diff[0]),
    distanceY: Math.abs(diff[1]),
    distanceZ: Math.abs(diff[2]),
    measureInfoA: { point: pointA, validMeasureSettings: canUseCylinderSettings },
    measureInfoB: { point: pointB, validMeasureSettings: canUseCylinderSettings },
    angle: angle3
  };
}
function cylinderToPlaneMeasure(cylinder, cylinderInstanceMat, plane, planeProduct, planeFace, planeInstance, scale6, canUseCylinderSettings, cylinderMeasure) {
  const cylinderNormalMat = mat3_exports.normalFromMat4(
    mat3_exports.create(),
    cylinderInstanceMat
  );
  const cylinderMat = mat4_exports.fromValues(
    ...cylinder.transform
  );
  const cylinderPoint = mat4_exports.getTranslation(vec3_exports.create(), cylinderMat);
  vec3_exports.transformMat4(cylinderPoint, cylinderPoint, cylinderInstanceMat);
  const cylinderDir = vec3_exports.fromValues(
    cylinderMat[8],
    cylinderMat[9],
    cylinderMat[10]
  );
  vec3_exports.transformMat3(cylinderDir, cylinderDir, cylinderNormalMat);
  vec3_exports.normalize(cylinderDir, cylinderDir);
  const [planePoint, planeNorm] = decomposePlane(
    planeProduct,
    planeFace,
    planeInstance,
    plane
  );
  const dot4 = vec3_exports.dot(cylinderDir, planeNorm);
  const parallel = dot4 < 1e-6 && dot4 > -1e-4;
  if (parallel) {
    const d1 = vec3_exports.dot(planeNorm, planePoint);
    const d2 = vec3_exports.dot(planeNorm, cylinderPoint);
    let d = d2 - d1;
    if (cylinderMeasure == "closest") {
      d = d > 0 ? d - cylinder.radius * scale6 : d + cylinder.radius * scale6;
    } else if (cylinderMeasure == "furthest") {
      d = d > 0 ? d + cylinder.radius * scale6 : d - cylinder.radius * scale6;
    }
    const cylinerPlanePoint = vec3_exports.add(
      vec3_exports.create(),
      planePoint,
      vec3_exports.scale(vec3_exports.create(), planeNorm, d)
    );
    return {
      drawKind: "measureResult",
      normalDistance: Math.abs(d),
      distanceX: 0,
      distanceY: 0,
      distanceZ: 0,
      normalPoints: [planePoint, cylinerPlanePoint],
      measureInfoA: { validMeasureSettings: canUseCylinderSettings },
      measureInfoB: { validMeasureSettings: canUseCylinderSettings }
    };
  }
}
async function getSegmentToSegmentMeasureValues(productA, segIdxA, instanceIdxA, productB, segIdxB, instanceIdxB) {
  let curveA = MeasureTool.geometryFactory.getCurve3DFromSegment(productA, segIdxA);
  let curveB = MeasureTool.geometryFactory.getCurve3DFromSegment(productB, segIdxB);
  if (curveA && curveB) {
    return getCurveToCurveMeasureValues(
      productA,
      curveA,
      instanceIdxA,
      productB,
      curveB,
      instanceIdxB
    );
  }
  return void 0;
}
async function getSegmentToEdgeMeasureValues(productA, segIdx, instanceIdxA, productB, edgeIdx, instanceIdxB) {
  let curveA = MeasureTool.geometryFactory.getCurve3DFromSegment(productA, segIdx);
  let curveB = MeasureTool.geometryFactory.getCurve3DFromEdge(productB, edgeIdx);
  if (curveA && curveB) {
    return getCurveToCurveMeasureValues(
      productA,
      curveA,
      instanceIdxA,
      productB,
      curveB,
      instanceIdxB
    );
  }
  return void 0;
}
async function getFaceToFaceMeasureValues(productA, faceIdxA, instanceIdxA, productB, faceIdxB, instanceIdxB, settingA, settingB) {
  const faceDataA = productA.faces[faceIdxA];
  const surfaceDataA = productA.surfaces[faceDataA.surface];
  let surfaceA = {
    surf: MeasureTool.geometryFactory.getSurface(surfaceDataA, 1),
    instanceIdx: instanceIdxA,
    faceData: faceDataA,
    data: surfaceDataA,
    product: productA,
    setting: settingA
  };
  const faceDataB = productB.faces[faceIdxB];
  const surfaceDataB = productB.surfaces[faceDataB.surface];
  let surfaceB = {
    surf: MeasureTool.geometryFactory.getSurface(surfaceDataB, 1),
    instanceIdx: instanceIdxB,
    faceData: faceDataB,
    data: surfaceDataB,
    product: productB,
    setting: settingB
  };
  if (surfaceA.surf && surfaceB.surf) {
    const entities = [surfaceA, surfaceB];
    entities.sort((a, b) => a.surf.kind.localeCompare(b.surf.kind));
    [surfaceA, surfaceB] = entities;
    const kindCombo = `${surfaceA.surf.kind}_${surfaceB.surf.kind}`;
    switch (kindCombo) {
      case "plane_plane":
        return planeToPlaneMeasure(
          surfaceA.product,
          surfaceA.faceData,
          surfaceA.instanceIdx,
          surfaceA.surf,
          surfaceB.product,
          surfaceB.faceData,
          surfaceB.instanceIdx,
          surfaceB.surf
        );
      case "cylinder_cylinder": {
        const cylinderA = surfaceA.data;
        const matA = matFromInstance(
          surfaceA.product.instances[surfaceA.instanceIdx]
        );
        const cylinderB = surfaceB.data;
        const matB = matFromInstance(
          surfaceB.product.instances[surfaceB.instanceIdx]
        );
        return cylinderToCylinderMeasure(
          cylinderA,
          matA,
          surfaceA.product,
          surfaceA.faceData,
          unitToScale(surfaceA.product.units),
          cylinderB,
          matB,
          surfaceB.product,
          surfaceB.faceData,
          unitToScale(surfaceB.product.units),
          surfaceA.setting?.cylinderMeasure ? surfaceA.setting.cylinderMeasure : "center",
          surfaceB.setting?.cylinderMeasure ? surfaceB.setting.cylinderMeasure : "center"
        );
      }
      case "cylinder_plane": {
        const cylinder = surfaceA.data;
        const cylinderInstanceMat = matFromInstance(
          surfaceA.product.instances[surfaceA.instanceIdx]
        );
        const canUseCylinderSettings = fullCircleCylinder(
          surfaceA.product,
          surfaceA.faceData
        );
        const plane = surfaceB.surf;
        return cylinderToPlaneMeasure(
          cylinder,
          cylinderInstanceMat,
          plane,
          surfaceB.product,
          surfaceB.faceData,
          surfaceB.instanceIdx,
          unitToScale(surfaceA.product.units),
          canUseCylinderSettings,
          surfaceA.setting?.cylinderMeasure && canUseCylinderSettings ? surfaceA.setting.cylinderMeasure : "center"
        );
      }
    }
  }
}
async function evalCurve(product, pathIdx, instanceIdx, paramter, pathKind) {
  const curve = pathKind == "edge" ? MeasureTool.geometryFactory.getCurve3DFromEdge(product, pathIdx) : MeasureTool.geometryFactory.getCurve3DFromSegment(product, pathIdx);
  if (curve) {
    paramter /= unitToScale(product.units);
    const pos = vec3_exports.create();
    const dir = vec3_exports.create();
    curve.eval(paramter, pos, dir);
    const mat = matFromInstance(product.instances[instanceIdx]);
    const normalMat = mat3_exports.normalFromMat4(mat3_exports.create(), mat);
    vec3_exports.transformMat3(dir, dir, normalMat);
    vec3_exports.transformMat4(pos, pos, mat);
    vec3_exports.normalize(dir, dir);
    vec3_exports.negate(dir, dir);
    return [pos, dir];
  }
}

// /projects/Novorender/ts/dist/measure/worker/outline.ts
common_exports.setMatrixArrayType(Array);
var epsilon2 = 1e-4;
function constructEdgeKey(a, b) {
  if (a > b) {
    [b, a] = [a, b];
  }
  return BigInt(a) | BigInt(b) << 32n;
}
function evalTriangulation(surface, triangulation, productMatrix) {
  const vertices = [];
  const productNormalMatrix = productMatrix ? mat3_exports.normalFromMat4(mat3_exports.create(), productMatrix) : void 0;
  for (let i = 0; i < triangulation.vertices.length; i += 2) {
    const uv = vec2_exports.fromValues(triangulation.vertices[i], triangulation.vertices[i + 1]);
    const pos = vec3_exports.create();
    const normal = vec3_exports.create();
    surface.evalPosition(pos, uv);
    surface.evalNormal(normal, uv);
    if (productMatrix && productNormalMatrix) {
      vec3_exports.transformMat4(pos, pos, productMatrix);
      vec3_exports.transformMat3(normal, normal, productNormalMatrix);
      vec3_exports.normalize(normal, normal);
    }
    vertices.push({ pos, uv, normal });
  }
  return vertices;
}
function evalTesselation(curve, transform) {
  const vertices = [];
  const normalMat = mat3_exports.normalFromMat4(mat3_exports.create(), transform);
  for (const t of curve.tesselationParameters) {
    const pos = vec3_exports.create();
    const tangent = vec3_exports.create();
    curve.eval(t, pos, tangent);
    vec3_exports.transformMat4(pos, pos, transform);
    vec3_exports.transformMat3(tangent, tangent, normalMat);
    vec3_exports.normalize(tangent, tangent);
    vertices.push({ pos, t, tangent });
  }
  return vertices;
}
function createTopology(face) {
  const edges = [];
  const edgeMap = /* @__PURE__ */ new Map();
  const triangles = [];
  const { surface, triangulation } = face;
  const vertices = evalTriangulation(surface, triangulation, face.geometryTransformation);
  const vertexRemap = vertices.map((_, i) => i);
  for (const seam of face.seams) {
    for (const [a, b] of seam.vertexIndexPairs) {
      vertexRemap[b] = a;
      console.assert(vec3_exports.distance(vertices[a].pos, vertices[b].pos) < 1e-4);
    }
  }
  const { indices } = triangulation;
  for (let i = 0; i < indices.length; i += 3) {
    let addEdge2 = function(v02, v12) {
      const key = constructEdgeKey(v02, v12);
      let edgeIndex = edgeMap.get(key);
      if (void 0 === edgeIndex) {
        edgeIndex = edges.length;
        edgeMap.set(key, edgeIndex);
        edges.push({
          vertices: [v02, v12],
          triangles: [triangleIndex]
        });
      } else {
        const { triangles: triangles2 } = edges[edgeIndex];
        console.assert(triangles2.length == 1);
        edges[edgeIndex].triangles.push(triangleIndex);
        edgeIndex = edgeIndex;
      }
      return edgeIndex;
    };
    var addEdge = addEdge2;
    const triangleIndex = triangles.length;
    const vi = indices.slice(i, i + 3).map((vi2) => vertexRemap[vi2]);
    if (face.sense == -1) {
      vi.reverse();
    }
    const [v0, v1, v2] = vi;
    const ab = vec3_exports.subtract(vec3_exports.create(), vertices[v1].pos, vertices[v0].pos);
    const ac = vec3_exports.subtract(vec3_exports.create(), vertices[v2].pos, vertices[v0].pos);
    const normal = vec3_exports.create();
    vec3_exports.cross(normal, ab, ac);
    const l2 = vec3_exports.dot(normal, normal);
    if (l2 == 0)
      continue;
    vec3_exports.normalize(normal, normal);
    console.assert(vec3_exports.dot(normal, vertices[v0].normal) > 0);
    console.assert(vec3_exports.dot(normal, vertices[v1].normal) > 0);
    console.assert(vec3_exports.dot(normal, vertices[v2].normal) > 0);
    const e0 = addEdge2(v0, v1);
    const e1 = addEdge2(v1, v2);
    const e2 = addEdge2(v2, v0);
    const p0 = vertices[v0].pos;
    const p1 = vertices[v1].pos;
    const p2 = vertices[v2].pos;
    const triangle = {
      vertices: [v0, v1, v2],
      edges: [e0, e1, e2],
      normal
    };
    triangles.push(triangle);
  }
  return {
    triangles,
    vertices,
    edges
  };
}
function triangleVertexFacing(indices, normals) {
  const [ia, ib, ic] = indices;
  const az = normals[ia][2];
  const bz = normals[ib][2];
  const cz = normals[ic][2];
  if (az > epsilon2 && bz > epsilon2 && cz > epsilon2) {
    return 1;
  } else if (az < epsilon2 && bz < epsilon2 && cz < epsilon2) {
    return -1;
  }
  return 0;
}
function edgeVertexStraddling(indices, normals) {
  const [ia, ib] = indices;
  const az = normals[ia][2];
  const bz = normals[ib][2];
  if (az > epsilon2 && bz > epsilon2) {
    return 0;
  } else if (az < epsilon2 && bz < epsilon2) {
    return 0;
  }
  return Math.sign(az - bz);
}
function edgeVertexFacing(indices, normals) {
  const [ia, ib] = indices;
  const az = normals[ia][2];
  const bz = normals[ib][2];
  if (az > epsilon2 && bz > epsilon2) {
    return 1;
  } else if (az < epsilon2 && bz < epsilon2) {
    return -1;
  }
  return 0;
}
function edgeStraddleParameter(indices, normals) {
  const [ia, ib] = indices;
  const az = normals[ia][2];
  const bz = normals[ib][2];
  let t = (az - epsilon2) / (az - bz);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
function getEdgeStrip(edge, sense) {
  const v = evalTesselation(edge.curve, edge.geometryTransformation).map((v2) => v2.pos);
  return sense > 0 ? v : v.reverse();
}
function getBrepEdges(edges, worldViewMatrix) {
  const paths = [];
  for (let i = 0; i < edges.length; ++i) {
    const edge = edges[i];
    if (!edge) {
      continue;
    }
    const vertices = evalTesselation(edge.curve, edge.geometryTransformation);
    const verticiesVS = vertices.map((v) => vec3_exports.transformMat4(vec3_exports.create(), v.pos, worldViewMatrix));
    const pathParts = [];
    let [x, y] = verticiesVS[0];
    pathParts.push(`M ${x} ${y}`);
    for (let i2 = 1; i2 < vertices.length; ++i2) {
      [x, y] = verticiesVS[i2];
      pathParts.push(`L ${x} ${y}`);
    }
    const path = pathParts.join(" ");
    paths.push({ path, centerDepth: 0, originalIndex: i, instanceIndex: edge.instanceIndex, kind: "edge" });
  }
  return paths;
}
function getBrepFaces(faces, worldViewMatrix) {
  const paths = [];
  for (let i = 0; i < faces.length; ++i) {
    let polygonWinding2 = function(loop) {
      let totalArea = 0;
      for (let i2 = 0; i2 < loop.length; ++i2) {
        const a = loop[i2];
        const b = loop[(i2 + 1) % loop.length];
        const cp = (b[0] - a[0]) * (b[1] + a[1]);
        totalArea += cp;
      }
      console.assert(totalArea != 0);
      return Math.sign(totalArea);
    }, endPath2 = function() {
      const path = pathParts.join(" ");
      const centerDepth = (minDepth + maxDepth) / 2;
      paths.push({ path, centerDepth, originalIndex: i, instanceIndex: face.instanceIndex, kind: "face" });
    };
    var polygonWinding = polygonWinding2, endPath = endPath2;
    const face = faces[i];
    const { loops } = getProjectedLoops(face, worldViewMatrix);
    let minDepth = Number.MAX_VALUE;
    let maxDepth = Number.MIN_VALUE;
    const pathParts = [];
    const windings = [];
    for (const loopWS of loops) {
      const loopVS = loopWS.map((v) => vec3_exports.transformMat4(vec3_exports.create(), v, worldViewMatrix));
      const winding = -polygonWinding2(loopVS);
      windings.push(winding);
      for (const v of loopVS) {
        const depth = v[2];
        if (minDepth > depth) {
          minDepth = depth;
        }
        if (maxDepth < depth) {
          maxDepth = depth;
        }
      }
      const [x, y] = loopVS[loopVS.length - 1];
      pathParts.push(`M ${x} ${y}`);
      for (const v of loopVS) {
        const [x2, y2] = v;
        pathParts.push(`L ${x2} ${y2}`);
      }
    }
    endPath2();
  }
  return paths;
}
function getContourEdges(topology, normalsVS) {
  const { edges, triangles, vertices } = topology;
  const edgeStraddle = edges.map((e) => edgeVertexStraddling(e.vertices, normalsVS));
  const straddlingTriangleIndices = triangles.map((t, i) => i).filter((i) => triangleVertexFacing(triangles[i].vertices, normalsVS) == 0);
  const remainingTriangles = new Set(straddlingTriangleIndices);
  const straddlePoints = edges.map((e, i) => {
    if (edgeStraddle[i] == 0) {
      return void 0;
    }
    const t = edgeStraddleParameter(e.vertices, normalsVS);
    const va = vertices[e.vertices[0]];
    const vb = vertices[e.vertices[1]];
    return vec3_exports.lerp(vec3_exports.create(), va.pos, vb.pos, t);
  });
  function traverseContourEdges(edge) {
    const edgeStrip = [];
    edgeStrip.push(edge);
    let currentEdge = edge;
    let run = true;
    while (run) {
      run = false;
      for (const triangleIndex of edges[currentEdge].triangles) {
        if (remainingTriangles.delete(triangleIndex)) {
          const triangle = triangles[triangleIndex];
          const straddleEdges = triangle.edges.filter((i) => edgeStraddle[i] != 0 && i != currentEdge);
          console.assert(straddleEdges.length == 1);
          currentEdge = straddleEdges[0];
          edgeStrip.push(currentEdge);
          run = true;
          break;
        }
      }
    }
    return edgeStrip;
  }
  function isContourLoop(edgeStart, edgeEnd) {
    const start = edges[edgeStart].triangles;
    const end = edges[edgeEnd].triangles;
    return start.some((i) => end.some((j) => j == i));
  }
  function createStripFromStraddleEdges(loop) {
    const strip = [];
    for (const index of loop) {
      strip.push(straddlePoints[index]);
    }
    return strip;
  }
  const strips = [];
  const loops = [];
  while (remainingTriangles.size > 0) {
    const keys = [...remainingTriangles.keys()];
    const triangleIndex = remainingTriangles.keys().next().value;
    remainingTriangles.delete(triangleIndex);
    const triangle = triangles[triangleIndex];
    const triangleEdges = triangle.edges;
    const straddleEdges = triangleEdges.filter((i) => edgeStraddle[i] != 0);
    straddleEdges.sort((a, b) => edgeStraddle[a] - edgeStraddle[b]);
    const leftStrip = traverseContourEdges(straddleEdges[0]);
    const rightStrip = traverseContourEdges(straddleEdges[1]);
    const combinedStrip = [...rightStrip.reverse(), ...leftStrip];
    if (isContourLoop(combinedStrip[0], combinedStrip[combinedStrip.length - 1])) {
      loops.push(createStripFromStraddleEdges(combinedStrip));
    } else {
      strips.push(combinedStrip);
    }
  }
  const contourStrips = strips.map((s) => {
    return { startEdge: s[0], endEdge: s[s.length - 1], strip: s.map((i) => straddlePoints[i]) };
  });
  return { loops, contourStrips };
}
function getTrimEdges(topology, normalsVS, facing = 1) {
  const { edges } = topology;
  const edgeFacing = edges.map((e) => edgeVertexFacing(e.vertices, normalsVS));
  const edgeIndices = edges.map((e, i) => i);
  const trimEdgeIndices = edgeIndices.filter((i) => edges[i].triangles.length === 1 && edgeFacing[i] * facing >= 0);
  return trimEdgeIndices;
}
function getTrimStrips(topology, normalsVS) {
  const { edges, vertices } = topology;
  const trimEdgeIndices = getTrimEdges(topology, normalsVS);
  const trimEdgesMap = /* @__PURE__ */ new Map();
  const edgeReferences = new Array(edges.length).fill(0);
  for (const trimEdgeIndex of trimEdgeIndices) {
    const trimEdge = edges[trimEdgeIndex];
    let [va, vb] = trimEdge.vertices;
    console.assert(!trimEdgesMap.has(va));
    ++edgeReferences[va];
    --edgeReferences[vb];
    trimEdgesMap.set(va, [vb, trimEdgeIndex]);
  }
  const beginEdges = edgeReferences.map((count, index) => ({ index, count })).filter((e) => e.count == 1);
  const trimLoops = [];
  const trimStrips = [];
  function traverseEdges(startKey) {
    let strip = [];
    let head = startKey;
    const value = trimEdgesMap.get(head);
    const startEdge = value[1];
    let endEdge = value[1];
    do {
      strip.push(vertices[head].pos);
      const tail = head;
      const value2 = trimEdgesMap.get(tail);
      trimEdgesMap.delete(tail);
      if (value2 === void 0) {
        break;
      }
      head = value2[0];
      endEdge = value2[1];
      console.assert(strip.length < 1e5);
    } while (head != startKey);
    if (head == startKey) {
      endEdge = startEdge;
      return { kind: "loop", strip };
    } else {
      strip = strip.slice(1, strip.length - 1);
    }
    return { kind: "strip", startEdge, endEdge, strip };
  }
  for (const beginEdge of beginEdges) {
    const strip = traverseEdges(beginEdge.index);
    if (strip.kind === "strip") {
      trimStrips.push(strip);
    } else {
      console.assert(false);
    }
  }
  while (trimEdgesMap.size > 0) {
    const key = trimEdgesMap.keys().next().value;
    const { kind, strip } = traverseEdges(key);
    trimLoops.push(strip);
    console.assert(kind == "loop");
  }
  return { trimLoops, trimStrips };
}
function* loopsFromStrips(combinedStrips) {
  while (combinedStrips.length > 0) {
    const loop = [];
    let current = combinedStrips.pop();
    const loopStartEdge = current.startEdge;
    loop.push(...current.strip);
    for (; ; ) {
      let foundIndex = void 0;
      for (let i = 0; i < combinedStrips.length; ++i) {
        const { startEdge } = combinedStrips[i];
        if (startEdge == current.endEdge) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex !== void 0) {
        current = combinedStrips[foundIndex];
        loop.push(...current.strip);
        combinedStrips.splice(foundIndex, 1);
      } else {
        break;
      }
    }
    if (loopStartEdge === current.endEdge) {
      yield loop;
    } else {
      console.error("Unable to join to loop");
    }
  }
}
function projectFace(topology, worldViewMatrix) {
  const { vertices } = topology;
  const positionsVS = new Array(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    positionsVS[i] = vec3_exports.create();
    vec3_exports.transformMat4(positionsVS[i], vertices[i].pos, worldViewMatrix);
  }
  const normalsVS = new Array(vertices.length);
  const worldViewMatrixNormal = mat3_exports.normalFromMat4(mat3_exports.create(), worldViewMatrix);
  for (let i = 0; i < vertices.length; i++) {
    normalsVS[i] = vec3_exports.create();
    vec3_exports.transformMat3(normalsVS[i], vertices[i].normal, worldViewMatrixNormal);
  }
  const cameraDir = vec3_exports.fromValues(0, 0, 1);
  vec3_exports.transformMat3(cameraDir, cameraDir, worldViewMatrixNormal);
  return { positionsVS, normalsVS };
}
function getProjectedLoops(face, worldViewMatrix) {
  const topology = createTopology(face);
  const { normalsVS, positionsVS } = projectFace(topology, worldViewMatrix);
  const loops = [];
  const { trimLoops, trimStrips } = getTrimStrips(topology, normalsVS);
  loops.push(...trimLoops);
  const { loops: contourLoops, contourStrips } = getContourEdges(topology, normalsVS);
  loops.push(...contourLoops);
  const combinedStrips = [...contourStrips, ...trimStrips];
  loops.push(...loopsFromStrips(combinedStrips));
  const { vertices, triangles, edges } = topology;
  const trimEdges = getTrimEdges(topology, normalsVS, 0).map((i) => edges[i].vertices);
  return { loops, trimLoops, contourLoops, trimEdges, vertices, positionsVS };
}

// /projects/Novorender/ts/dist/measure/worker/extract_values.ts
async function extractCurveValues(product, pathIdx, instanceIdx, pathKind) {
  const start = vec3_exports.create();
  const end = vec3_exports.create();
  const parameterData = pathKind == "edge" ? product.edges[pathIdx] : product.curveSegments[pathIdx];
  if (parameterData.curve3D != void 0) {
    const curveData = product.curves3D[parameterData.curve3D];
    switch (curveData.kind) {
      case "line": {
        const mat = matFromInstance(product.instances[instanceIdx]);
        const edgeCurve = pathKind == "edge" ? MeasureTool.geometryFactory.getCurve3DFromEdge(product, pathIdx) : MeasureTool.geometryFactory.getCurve3DFromSegment(product, pathIdx);
        edgeCurve?.eval(parameterData.parameterBounds[0], start, void 0);
        edgeCurve?.eval(parameterData.parameterBounds[1], end, void 0);
        const dir = vec3_exports.subtract(vec3_exports.create(), end, start);
        vec3_exports.transformMat4(start, start, mat);
        vec3_exports.transformMat4(end, end, mat);
        let dist4 = vec3_exports.len(dir);
        dist4 *= unitToScale(product.units);
        vec3_exports.normalize(dir, dir);
        return { kind: "line", distance: dist4, gradient: dir, start, end };
      }
      case "circle": {
        const totalAngle = parameterData.parameterBounds[1] - parameterData.parameterBounds[0];
        return {
          kind: "arc",
          radius: curveData.radius * unitToScale(product.units),
          totalAngle
        };
      }
      case "lineStrip": {
        const closed = vec3_exports.equals(
          curveData.vertices[0],
          curveData.vertices[curveData.vertices.length - 1]
        );
        return {
          kind: "lineStrip",
          totalLength: closed ? void 0 : (parameterData.parameterBounds[1] - parameterData.parameterBounds[0]) * unitToScale(product.units)
        };
      }
    }
  }
}
async function extractPlaneValues(prodId, faceIdx, product, instanceIdx, faceData, surf, scale6) {
  function union(out, a) {
    vec2_exports.min(out.min, out.min, a.min);
    vec2_exports.max(out.max, out.max, a.max);
  }
  const loopToEdges = async (loop2) => {
    let useRadius = true;
    let radius = 0;
    let edges = [];
    for (const halfEdgeIdx of loop2.halfEdges) {
      const halfEdgeData = product.halfEdges[halfEdgeIdx];
      const edgeValue = await extractCurveValues(
        product,
        halfEdgeData.edge,
        instanceIdx,
        "edge"
      );
      if (edgeValue) {
        if (useRadius) {
          if (edgeValue.kind != "arc") {
            useRadius = false;
            radius = void 0;
          } else {
            radius = Math.max(edgeValue.radius, radius) * scale6;
          }
        }
        edges.push(edgeValue);
      }
    }
    return {
      edges,
      useRadius,
      radius
    };
  };
  const mat = matFromInstance(product.instances[instanceIdx]);
  function addVertexFromIndex(points, index) {
    const v = vec3_exports.clone(product.vertices[index].position);
    vec3_exports.transformMat4(v, v, mat);
    points.push(v);
  }
  let hasWidthAndHeight = true;
  const loop = product.loops[faceData.outerLoop];
  const aabb = {
    min: vec2_exports.fromValues(Number.MAX_VALUE, Number.MAX_VALUE),
    max: vec2_exports.fromValues(-Number.MAX_VALUE, -Number.MAX_VALUE)
  };
  let verts = [];
  for (const halfEdgeIdx of loop.halfEdges) {
    const aabb2 = MeasureTool.geometryFactory.getHalfEdgeAABB(product, halfEdgeIdx);
    if (!aabb2) {
      break;
    }
    union(aabb, aabb2);
    const halfEdgeData = product.halfEdges[halfEdgeIdx];
    const edgeData = product.edges[halfEdgeData.edge];
    if (edgeData.vertices) {
      if (halfEdgeData.direction === 1) {
        addVertexFromIndex(verts, edgeData.vertices[0]);
      } else {
        addVertexFromIndex(verts, edgeData.vertices[1]);
      }
    }
  }
  const normal = vec3_exports.create();
  const normalMat = mat3_exports.normalFromMat4(mat3_exports.create(), mat);
  surf.evalNormal(normal, [0, 0]);
  vec3_exports.transformMat3(normal, normal, normalMat);
  const xyNormal = vec3_exports.fromValues(0, 0, 1);
  const dotXyPlane = Math.abs(vec3_exports.dot(normal, xyNormal));
  let heightAboveXyPlane = void 0;
  if (1 - dotXyPlane < epsilon3) {
    const pos = vec3_exports.create();
    surf.evalPosition(pos, [0, 0]);
    vec3_exports.scale(pos, pos, 1 / scale6);
    vec3_exports.transformMat4(pos, pos, mat);
    heightAboveXyPlane = pos[2];
  }
  let outerEdges = await loopToEdges(loop);
  let innerEdges = [];
  let innerRadius = void 0;
  if (faceData.innerLoops) {
    let useInnerRadius = true;
    innerRadius = 0;
    for (const innerLoopIdx of faceData.innerLoops) {
      const innerLoop = product.loops[innerLoopIdx];
      const edgeResult = await loopToEdges(innerLoop);
      innerEdges.push(edgeResult.edges);
      useInnerRadius = edgeResult.useRadius && useInnerRadius;
      if (edgeResult.radius) {
        innerRadius = Math.max(innerRadius, edgeResult.radius);
      }
    }
    if (!useInnerRadius) {
      innerRadius = void 0;
    }
  }
  let width = void 0;
  let height = void 0;
  if (!outerEdges.useRadius) {
    width = (aabb.max[0] - aabb.min[0]) * scale6;
    height = (aabb.max[1] - aabb.min[1]) * scale6;
  }
  return {
    kind: "plane",
    width,
    height,
    outerRadius: outerEdges.radius,
    innerRadius,
    normal,
    area: faceData.area ? faceData.area * scale6 * scale6 : void 0,
    vertices: verts,
    outerEdges: outerEdges.edges,
    innerEdges,
    heightAboveXyPlane,
    entity: {
      ObjectId: prodId,
      drawKind: "face",
      pathIndex: faceIdx,
      instanceIndex: instanceIdx
    }
  };
}
async function extractCylinderValues(prodId, faceIdx, product, instanceIdx, faceData, cylinderData, scale6, setting) {
  const mat = matFromInstance(product.instances[instanceIdx]);
  const [cylinderOrigo, cylinderEnd] = await cylinderCenterLine(
    product,
    faceData,
    cylinderData,
    mat,
    setting ? setting.cylinderMeasure : "center"
  );
  return {
    kind: "cylinder",
    radius: cylinderData.radius * scale6,
    centerLineStart: cylinderOrigo,
    centerLineEnd: cylinderEnd,
    entity: {
      ObjectId: prodId,
      drawKind: "face",
      pathIndex: faceIdx,
      instanceIndex: instanceIdx
    }
  };
}
async function extractFaceValues(prodId, product, faceIdx, instanceIdx, setting) {
  const faceData = product.faces[faceIdx];
  const scale6 = unitToScale(product.units);
  const surfaceData = product.surfaces[faceData.surface];
  const surf = MeasureTool.geometryFactory.getSurface(
    surfaceData,
    faceData.facing,
    scale6
  );
  switch (surf.kind) {
    case "plane": {
      return await extractPlaneValues(prodId, faceIdx, product, instanceIdx, faceData, surf, scale6);
    }
    case "cylinder": {
      const cylinderData = surfaceData;
      return await extractCylinderValues(prodId, faceIdx, product, instanceIdx, faceData, cylinderData, scale6, setting);
    }
  }
}
async function extractCameraValuesFromFace(product, faceIdx, instanceIdx, cameraDir, setting) {
  const faceData = product.faces[faceIdx];
  const surfaceData = product.surfaces[faceData.surface];
  switch (surfaceData.kind) {
    case "cylinder": {
      const cylinderA = surfaceData;
      const mat = matFromInstance(product.instances[instanceIdx]);
      const [cylinderOrigo, cylinderEnd] = await cylinderCenterLine(
        product,
        faceData,
        cylinderA,
        mat,
        setting ? setting.cylinderMeasure : "center"
      );
      const cylinderDir = vec3_exports.sub(vec3_exports.create(), cylinderEnd, cylinderOrigo);
      vec3_exports.normalize(cylinderDir, cylinderDir);
      const dotCamera = vec3_exports.dot(cameraDir, cylinderDir);
      if (Math.abs(dotCamera) > 0.8) {
        let position2;
        if (dotCamera < 0) {
          position2 = cylinderEnd;
        } else {
          vec3_exports.negate(cylinderDir, cylinderDir);
          position2 = cylinderOrigo;
        }
        return { normal: cylinderDir, position: position2 };
      }
      const position = vec3_exports.lerp(
        vec3_exports.create(),
        cylinderOrigo,
        cylinderEnd,
        0.5
      );
      const xAxis = vec3_exports.cross(
        vec3_exports.create(),
        cylinderDir,
        vec3_exports.fromValues(1, 0, 0)
      );
      const dotX = vec3_exports.dot(cameraDir, xAxis);
      const absDotX = Math.abs(dotX);
      const yAxis = vec3_exports.cross(
        vec3_exports.create(),
        cylinderDir,
        vec3_exports.fromValues(0, 1, 0)
      );
      const dotY = vec3_exports.dot(cameraDir, yAxis);
      const absDotY = Math.abs(dotY);
      const zAxis = vec3_exports.cross(
        vec3_exports.create(),
        cylinderDir,
        vec3_exports.fromValues(0, 0, 1)
      );
      const dotZ = vec3_exports.dot(cameraDir, zAxis);
      const absDotZ = Math.abs(dotZ);
      if (absDotX > absDotY && absDotX > absDotZ) {
        if (dotX > 0) {
          vec3_exports.negate(xAxis, xAxis);
        }
        return { normal: xAxis, position };
      } else if (absDotY > absDotZ) {
        if (dotY > 0) {
          vec3_exports.negate(yAxis, yAxis);
        }
        return { normal: yAxis, position };
      } else {
        if (dotZ > 0) {
          vec3_exports.negate(zAxis, zAxis);
        }
        return { normal: zAxis, position };
      }
    }
  }
}

// /projects/Novorender/ts/dist/measure/worker/parametric_product.ts
async function toParametricProduct(prodId, product) {
  const handleLoop = async (loop, instanceIdx) => {
    const loopEdges = [];
    for (const halfEdgeIdx of loop.halfEdges) {
      const halfEdge = product.halfEdges[halfEdgeIdx];
      loopEdges.push({
        index: halfEdge.edge,
        values: await extractCurveValues(
          product,
          halfEdge.edge,
          instanceIdx,
          "edge"
        )
      });
    }
    return loopEdges;
  };
  const handleShell = async (shellData, instanceIdx) => {
    const outerFaces = [];
    for (const faceIdx of shellData.faces) {
      const faceData = product.faces[faceIdx];
      const outerLoop = await handleLoop(
        product.loops[faceData.outerLoop],
        instanceIdx
      );
      if (outerLoop == void 0) {
        return void 0;
      }
      let innerLoops = void 0;
      if (faceData.innerLoops) {
        innerLoops = [];
        for (const loopIdx of faceData.innerLoops) {
          const innerLoop = await handleLoop(
            product.loops[loopIdx],
            instanceIdx
          );
          if (innerLoop == void 0) {
            return void 0;
          }
          innerLoops.push(innerLoop);
        }
      }
      outerFaces.push({
        index: faceIdx,
        outerLoop,
        innerLoops,
        values: await extractFaceValues(prodId, product, faceIdx, instanceIdx)
      });
      return outerFaces;
    }
  };
  const geometries = [];
  for (let i = 0; i < product.instances.length; ++i) {
    const instanceData = product.instances[i];
    const mat = matFromInstance(instanceData);
    const geometryData = product.geometries[instanceData.geometry];
    const solids = [];
    let volume = 0;
    if (geometryData.shells) {
      for (const shellIdx of geometryData.shells) {
        const shellData = product.shells[shellIdx];
        if (shellData.volume) {
          volume += shellData.volume;
        }
        const outerFaces = await handleShell(shellData, i);
        if (outerFaces) {
          solids.push({
            volume: volume == 0 ? void 0 : volume,
            outerShell: outerFaces
          });
        } else {
          return void 0;
        }
      }
    }
    if (geometryData.solids) {
      for (const solidIdx of geometryData.solids) {
        const solidData = product.solids[solidIdx];
        const outerShellData = product.shells[solidData.outerShell];
        if (outerShellData.volume) {
          volume += outerShellData.volume;
        }
        const outerShell = await handleShell(outerShellData, i);
        if (outerShell == void 0) {
          return void 0;
        }
        let innerShells = void 0;
        if (solidData.innerShells) {
          innerShells = [];
          for (const shellIdx of solidData.innerShells) {
            const innerShellData = product.shells[shellIdx];
            if (innerShellData.volume) {
              volume -= innerShellData.volume;
            }
            const innerShell = await handleShell(innerShellData, i);
            if (innerShell == void 0) {
              return void 0;
            }
            innerShells.push(innerShell);
          }
        }
        solids.push({
          volume: volume == 0 ? void 0 : volume,
          outerShell,
          innerShells
        });
      }
    }
    geometries.push({ index: i, solids });
  }
  return { geometries };
}

// /projects/Novorender/ts/dist/measure/worker/profile.ts
function slopeFromProfile(profile) {
  const slopes = [];
  if (profile.length > 0) {
    for (let i = 1; i < profile.length; ++i) {
      const prevP = profile[i - 1];
      const p = profile[i];
      const segLen = p[0] - prevP[0];
      const heightDiff = p[1] - prevP[1];
      slopes.push(heightDiff / segLen);
    }
  }
  return slopes;
}
function topAndBottomFromProfile(profile) {
  let top = Number.MIN_SAFE_INTEGER;
  let bottom = Number.MAX_SAFE_INTEGER;
  for (const v of profile) {
    top = Math.max(top, v[1]);
    bottom = Math.min(bottom, v[1]);
  }
  return { top, bottom };
}
function reduceProfile(profile) {
  const slopeEpsilon = 1e-4;
  const slopes = [];
  const newProfile = [];
  var elevations = topAndBottomFromProfile(profile);
  let startElevation = 0;
  let endElevation = 0;
  startElevation = profile[0][1];
  endElevation = profile[profile.length - 1][1];
  if (profile.length > 1) {
    let prevSlope = 0;
    newProfile.push(profile[0]);
    slopes.push(prevSlope);
    for (let i = 1; i < profile.length; ++i) {
      const prevP = profile[i - 1];
      const p = profile[i];
      const segLen = p[0] - prevP[0];
      const heightDiff = p[1] - prevP[1];
      const slope = heightDiff / segLen;
      if (Math.abs(slope - prevSlope) > slopeEpsilon) {
        slopes.push(prevSlope);
        newProfile.push(prevP);
      }
      prevSlope = slope;
    }
    newProfile.push(profile[profile.length - 1]);
    slopes.push(prevSlope);
  }
  return {
    profilePoints: newProfile,
    slopes,
    startElevation,
    endElevation,
    top: elevations.top,
    bottom: elevations.bottom
  };
}
function getCurveSegmentProfile(product, curveSeg, instanceIdx) {
  if (curveSeg && curveSeg.kind == "lineStrip") {
    const lineStrip = curveSeg;
    const mat = matFromInstance(product.instances[instanceIdx]);
    const profile = lineStrip.toProfile(mat);
    return reduceProfile(profile);
  }
  if (curveSeg && curveSeg.kind == "nurbs") {
    const nurbs = curveSeg;
    const vertices = [];
    let parameters = [];
    if (nurbs.order == 2) {
      for (let i = 1; i < nurbs.knots.length; ++i) {
        parameters.push(nurbs.knots[i]);
      }
      vertices.push(...nurbs.controlPoints);
    } else {
      parameters = nurbs.tesselationParameters;
      for (const p of nurbs.tesselationParameters) {
        const v = vec3_exports.create();
        nurbs.eval(p, v, void 0);
        vertices.push(v);
      }
    }
    const mat = matFromInstance(product.instances[instanceIdx]);
    const profile = getProfile(reduceLineStrip(vertices), parameters, mat);
    var elevations = topAndBottomFromProfile(profile);
    return {
      profilePoints: profile,
      slopes: slopeFromProfile(profile),
      startElevation: profile[0][1],
      endElevation: profile[profile.length - 1][1],
      top: elevations.top,
      bottom: elevations.bottom
    };
  }
}
async function getCylinderProfile(product, faceIdx, instanceIdx, setting) {
  const face = product.faces[faceIdx];
  const surfaceData = product.surfaces[face.surface];
  if (surfaceData.kind == "cylinder") {
    const mat = matFromInstance(product.instances[instanceIdx]);
    const [start, end] = await cylinderCenterLine(
      product,
      face,
      surfaceData,
      mat,
      setting ? setting.cylinderMeasure : "center"
    );
    const profile = [
      vec2_exports.fromValues(0, start[2]),
      vec2_exports.fromValues(
        vec2_exports.distance(
          vec2_exports.fromValues(start[0], start[1]),
          vec2_exports.fromValues(end[0], end[1])
        ),
        end[2]
      )
    ];
    var elevations = topAndBottomFromProfile(profile);
    return {
      profilePoints: profile,
      slopes: slopeFromProfile(profile),
      top: elevations.top,
      bottom: elevations.bottom,
      startElevation: profile[0][1],
      endElevation: profile[profile.length - 1][1]
    };
  }
}
async function addCenterLinesFromCylinders(product, centerLines, scale6, setting) {
  const smallLines = [];
  const faceInstances = new Array(product.instances.length);
  for (let i = 0; i < product.instances.length; ++i) {
    let faceFunc2 = function(faceIdx) {
      faces.push(faceIdx);
    };
    var faceFunc = faceFunc2;
    const instanceData = product.instances[i];
    const faces = new Array();
    if (typeof instanceData.geometry == "number") {
      crawlInstance(product, instanceData, faceFunc2);
    }
    faceInstances[i] = faces;
  }
  const cylinderMeasureSettings = setting ? setting.cylinderMeasure : "center";
  for (let i = 0; i < faceInstances.length; ++i) {
    const mat = matFromInstance(product.instances[i]);
    for (const faceIdx of faceInstances[i]) {
      const face = product.faces[faceIdx];
      const surfaceData = product.surfaces[face.surface];
      if (surfaceData.kind == "cylinder") {
        const [start, end] = await cylinderCenterLine(
          product,
          face,
          surfaceData,
          mat,
          cylinderMeasureSettings
        );
        const scaledRadius = surfaceData.radius * scale6;
        let add6 = true;
        const small = vec3_exports.dist(start, end) < scaledRadius;
        for (let centerline of small ? smallLines : centerLines) {
          const threshold = Math.abs(centerline.radius - scaledRadius) + 0.15;
          if (vec3_exports.distance(start, centerline.start) < threshold && vec3_exports.distance(end, centerline.end) < threshold) {
            add6 = false;
            if (cylinderMeasureSettings === "top") {
              if (centerline.radius < scaledRadius) {
                centerline.radius = scaledRadius;
                centerline.start = start;
                centerline.end = end;
              }
            } else if (centerline.radius > scaledRadius) {
              centerline.radius = scaledRadius;
              centerline.start = start;
              centerline.end = end;
            }
            break;
          }
        }
        if (add6) {
          if (small) {
            smallLines.push({
              start,
              end,
              radius: scaledRadius,
              checked: false
            });
          } else {
            centerLines.push({
              start,
              end,
              radius: scaledRadius,
              next: void 0,
              prev: void 0
            });
          }
        }
      }
    }
  }
  for (let i = 0; i < smallLines.length; ++i) {
    const testLine = smallLines[i];
    let add6 = false;
    if (testLine.checked) {
      continue;
    }
    for (let j = i + 1; j < smallLines.length; ++j) {
      if (smallLines[j].checked) {
        continue;
      }
      const dist4 = vec3_exports.dist(smallLines[j].start, testLine.end);
      const flippedDist = vec3_exports.dist(smallLines[j].end, testLine.end);
      if (dist4 < testLine.radius && dist4 < flippedDist) {
        vec3_exports.copy(testLine.end, smallLines[j].end);
        smallLines[j].checked = true;
        j = i + 1;
        add6 = true;
        continue;
      }
      if (flippedDist < testLine.radius) {
        vec3_exports.copy(testLine.end, smallLines[j].start);
        smallLines[j].checked = true;
        j = i + 1;
        add6 = true;
        continue;
      }
    }
    if (add6) {
      centerLines.push({
        start: testLine.start,
        end: testLine.end,
        radius: testLine.radius,
        next: void 0,
        prev: void 0
      });
    }
  }
}
function centerLinesToLinesTrip(centerLines) {
  if (centerLines.length == 1) {
    return [centerLines[0].start, centerLines[0].end];
  }
  const compare = (a, radiusA, b, radiusB) => {
    const dist4 = vec3_exports.distance(a, b);
    return dist4 < radiusA + radiusB;
  };
  let startSegment = void 0;
  for (let i = 0; i < centerLines.length; ++i) {
    const currentSegment = centerLines[i];
    let findNext = currentSegment.next == void 0;
    let findPrev = currentSegment.prev == void 0;
    for (let j = i + 1; j < centerLines.length; ++j) {
      if (!findPrev && !findNext) {
        break;
      }
      const checkSegment = centerLines[j];
      if (findPrev && compare(
        currentSegment.start,
        currentSegment.radius,
        checkSegment.end,
        checkSegment.radius
      )) {
        checkSegment.next = i;
        currentSegment.prev = j;
        findPrev = false;
      }
      if (findNext && compare(
        currentSegment.end,
        currentSegment.radius,
        checkSegment.start,
        checkSegment.radius
      )) {
        checkSegment.prev = i;
        currentSegment.next = j;
        findNext = false;
      }
    }
    if (findNext && i != centerLines.length - 1) {
      for (let j = i + 1; j < centerLines.length; ++j) {
        const checkSegment = centerLines[j];
        if (compare(
          currentSegment.end,
          currentSegment.radius,
          checkSegment.end,
          checkSegment.radius
        )) {
          const tmp = checkSegment.start;
          checkSegment.start = checkSegment.end;
          checkSegment.end = tmp;
          checkSegment.prev = i;
          currentSegment.next = j;
          break;
        }
      }
    }
    if (findPrev && i != centerLines.length - 1) {
      for (let j = i + 1; j < centerLines.length; ++j) {
        const checkSegment = centerLines[j];
        if (compare(
          currentSegment.start,
          currentSegment.radius,
          checkSegment.start,
          checkSegment.radius
        )) {
          const tmp = checkSegment.start;
          checkSegment.start = checkSegment.end;
          checkSegment.end = tmp;
          checkSegment.next = i;
          currentSegment.prev = j;
          break;
        }
      }
    }
    if (findPrev) {
      if (currentSegment.next === void 0 || startSegment != void 0 && startSegment.prev === void 0) {
        continue;
      }
      startSegment = currentSegment;
    }
  }
  const lineStrip = [];
  if (startSegment && startSegment.next === void 0) {
    lineStrip.push(vec3_exports.clone(startSegment.start));
    lineStrip.push(vec3_exports.clone(startSegment.end));
  } else if (startSegment && startSegment.next !== void 0) {
    let workingSegment = startSegment;
    lineStrip.push(vec3_exports.clone(startSegment.start));
    lineStrip.push(vec3_exports.clone(startSegment.end));
    let prevEnd = startSegment.end;
    while (workingSegment.next !== void 0) {
      workingSegment = centerLines[workingSegment.next];
      prevEnd = workingSegment.end;
      lineStrip.push(vec3_exports.clone(workingSegment.end));
    }
  }
  return lineStrip;
}

// /projects/Novorender/ts/dist/measure/worker/manhole.ts
async function manholeMeasure(product, prodId) {
  let top = void 0;
  let botInner = void 0;
  let botOuter = void 0;
  let outer = void 0;
  let inner = void 0;
  const botInnerCandiates = [];
  for (let i = 0; i < product.instances.length; ++i) {
    let faceFuncPlane2 = function(faceIdx) {
      if (product) {
        const face = product.faces[faceIdx];
        let radius = void 0;
        const outerLoop = product.loops[face.outerLoop];
        if (outerLoop.halfEdges.length == 1) {
          const halfEdge = product.halfEdges[outerLoop.halfEdges[0]];
          const edge = product.edges[halfEdge.edge];
          if (edge.curve3D != void 0) {
            const curve = product.curves3D[edge.curve3D];
            if (curve.kind == "circle") {
              radius = curve.radius;
            }
          }
        }
        const surf = product.surfaces[face.surface];
        if (surf.kind == "plane") {
          const transform = mat4_exports.fromValues(
            ...surf.transform
          );
          mat4_exports.multiply(transform, instanceMat, transform);
          const planeDir = vec3_exports.fromValues(transform[8], transform[9], transform[10]);
          if (Math.abs(vec3_exports.dot(planeDir, vec3_exports.fromValues(0, 0, 1))) < 0.8) {
            return;
          }
          const planePos = vec3_exports.fromValues(0, 0, 0);
          vec3_exports.transformMat4(planePos, planePos, transform);
          if (top === void 0 || botInner === void 0 || botOuter === void 0) {
            top = { elevation: planePos[2], entity: { faceData: face, instanceIdx: i, planeData: surf, faceIdx } };
            botInner = { elevation: planePos[2], radius, entity: { faceData: face, instanceIdx: i, planeData: surf, faceIdx } };
            botOuter = { elevation: planePos[2], radius, entity: { faceData: face, instanceIdx: i, planeData: surf, faceIdx } };
          } else {
            if (top.elevation < planePos[2]) {
              top = { elevation: planePos[2], entity: { faceData: face, instanceIdx: i, planeData: surf, faceIdx } };
            } else {
              let setOuter = false;
              if (radius === void 0) {
                setOuter = botOuter.elevation > planePos[2];
              } else {
                if (botOuter.radius == void 0) {
                  setOuter = botOuter.elevation > planePos[2];
                } else {
                  setOuter = radius > botOuter.radius || botOuter.radius === radius && botOuter.elevation > planePos[2];
                }
              }
              if (setOuter) {
                botOuter = { elevation: planePos[2], radius, entity: { faceData: face, instanceIdx: i, planeData: surf, faceIdx } };
              }
              if (radius != void 0) {
                botInnerCandiates.push({ elevation: planePos[2], radius, entity: { faceData: face, instanceIdx: i, planeData: surf, faceIdx } });
              }
            }
          }
        }
      }
    };
    var faceFuncPlane = faceFuncPlane2;
    const instanceData = product.instances[i];
    const instanceMat = matFromInstance(instanceData);
    if (typeof instanceData.geometry == "number") {
      crawlInstance(product, instanceData, faceFuncPlane2);
      botInnerCandiates.forEach((plane) => {
        const { radius, elevation } = plane;
        if (botInner && botOuter && radius) {
          let setInner = false;
          if (botInner.radius == void 0) {
            setInner = radius != void 0 || botOuter.elevation > elevation;
          } else {
            setInner = botOuter.radius != void 0 && botOuter.radius >= radius && botInner.elevation > elevation && elevation > botOuter.elevation;
          }
          if (setInner) {
            botInner = plane;
          }
        }
      });
    }
  }
  top = top;
  botOuter = botOuter;
  if (!top || !botOuter) {
    return void 0;
  }
  if (top.elevation == botOuter.elevation) {
    return void 0;
  }
  const totalLength = top.elevation - botOuter.elevation;
  const scale6 = unitToScale(product.units);
  if (totalLength * scale6 < 0.1) {
    return void 0;
  }
  const getCylinderTopBot = (origo, dir, l, transformElevation) => {
    const flipped = dir[2] <= 0;
    const t = vec3_exports.scaleAndAdd(vec3_exports.create(), origo, dir, flipped ? l * -1 : l);
    return t[2] > origo[2] ? [t[2] + transformElevation, origo[2] + transformElevation] : [origo[2] + transformElevation, t[2] + transformElevation];
  };
  let letInnerCylinderTopBot = void 0;
  for (let i = 0; i < product.instances.length; ++i) {
    let faceFuncCylinder2 = function(faceIdx) {
      if (product) {
        const face = product.faces[faceIdx];
        const surf = product.surfaces[face.surface];
        if (surf.kind == "cylinder") {
          const cylinderMtx = mat4_exports.fromValues(
            ...surf.transform
          );
          const cylinderOrigo = mat4_exports.getTranslation(vec3_exports.create(), cylinderMtx);
          const cylinderDir = vec3_exports.fromValues(
            cylinderMtx[8],
            cylinderMtx[9],
            cylinderMtx[10]
          );
          if (Math.abs(vec3_exports.dot(cylinderDir, vec3_exports.fromValues(0, 0, 1))) < 0.8) {
            return;
          }
          const transformElevation = instanceData.transformation ? instanceData.transformation[14] : 0;
          const len4 = Math.abs(cylinderLength(product, face, cylinderOrigo, cylinderDir));
          if (len4 > totalLength / 3) {
            if (outer == void 0 || inner == void 0) {
              outer = { radius: surf.radius, entity: { faceData: face, instanceIdx: i, cylinderData: surf, faceIdx } };
              inner = { radius: surf.radius, entity: { faceData: face, instanceIdx: i, cylinderData: surf, faceIdx } };
              letInnerCylinderTopBot = getCylinderTopBot(cylinderOrigo, cylinderDir, len4, transformElevation);
            } else {
              if (outer.radius < surf.radius) {
                outer = { radius: surf.radius, entity: { faceData: face, instanceIdx: i, cylinderData: surf, faceIdx } };
              } else if (inner.radius > surf.radius) {
                inner = { radius: surf.radius, entity: { faceData: face, instanceIdx: i, cylinderData: surf, faceIdx } };
                letInnerCylinderTopBot = getCylinderTopBot(cylinderOrigo, cylinderDir, len4, transformElevation);
              }
            }
          }
        }
      }
    };
    var faceFuncCylinder = faceFuncCylinder2;
    const instanceData = product.instances[i];
    if (typeof instanceData.geometry == "number") {
      crawlInstance(product, instanceData, faceFuncCylinder2);
    }
  }
  if (top && botOuter && outer && inner && botInner) {
    const scale7 = unitToScale(product.units);
    top = top;
    const topPlane = MeasureTool.geometryFactory.getSurface(
      top.entity.planeData,
      top.entity.faceData.facing,
      scale7
    );
    botOuter = botOuter;
    botInner = botInner;
    inner = inner;
    outer = outer;
    const oneCylinder = inner.radius === outer.radius;
    if (oneCylinder) {
      botInner = void 0;
    } else if (letInnerCylinderTopBot) {
      if (botInner.elevation >= letInnerCylinderTopBot[0]) {
        botInner = void 0;
      }
    }
    const botOuterPlane = MeasureTool.geometryFactory.getSurface(
      botOuter.entity.planeData,
      botOuter.entity.faceData.facing,
      scale7
    );
    const botInnerPlane = botInner ? MeasureTool.geometryFactory.getSurface(
      botInner.entity.planeData,
      botInner.entity.faceData.facing,
      scale7
    ) : void 0;
    return {
      drawKind: "manhole",
      ObjectId: prodId,
      top: await extractPlaneValues(prodId, top.entity.faceIdx, product, top.entity.instanceIdx, top.entity.faceData, topPlane, scale7),
      topElevation: top.elevation,
      bottomOuter: await extractPlaneValues(prodId, botOuter.entity.faceIdx, product, botOuter.entity.instanceIdx, botOuter.entity.faceData, botOuterPlane, scale7),
      bottomOuterElevation: botOuter.elevation,
      bottomInner: botInner ? await extractPlaneValues(prodId, botInner.entity.faceIdx, product, botInner.entity.instanceIdx, botInner.entity.faceData, botInnerPlane, scale7) : void 0,
      bottomInnerElevation: botInner ? botInner.elevation : letInnerCylinderTopBot ? letInnerCylinderTopBot[1] : void 0,
      inner: oneCylinder ? void 0 : await extractCylinderValues(prodId, inner.entity.faceIdx, product, inner.entity.instanceIdx, inner.entity.faceData, inner.entity.cylinderData, scale7),
      innerRadius: oneCylinder ? void 0 : inner.radius,
      outer: await extractCylinderValues(prodId, outer.entity.faceIdx, product, outer.entity.instanceIdx, outer.entity.faceData, outer.entity.cylinderData, scale7),
      outerRadius: outer.radius,
      internal: {
        top: top.entity.faceData,
        bottomOuter: botOuter.entity.faceData,
        bottomInner: botInner ? botInner.entity.faceData : void 0,
        inner: oneCylinder ? void 0 : inner.entity.faceData,
        outer: outer.entity.faceData
      }
    };
  }
  return void 0;
}

// /projects/Novorender/ts/dist/measure/worker/draw_objects.ts
async function getCylinderDrawParts(product, instanceIdx, cylinderData, face, setting) {
  const drawParts = [];
  const loop = product.loops[face.outerLoop];
  const mat = matFromInstance(product.instances[instanceIdx]);
  const [cylinderOrigo, cylinderEnd] = await cylinderCenterLine(
    product,
    face,
    cylinderData,
    mat,
    setting ? setting.cylinderMeasure : "center"
  );
  const diff = vec3_exports.sub(vec3_exports.create(), cylinderEnd, cylinderOrigo);
  const length4 = vec3_exports.length(diff);
  const planarLength = vec2_exports.len(vec2_exports.fromValues(diff[0], diff[1]));
  const epsilon4 = 1e-3;
  const dir = vec3_exports.normalize(vec3_exports.create(), diff);
  const vertical = Math.abs(Math.abs(dir[2]) - 1) < epsilon4;
  drawParts.push({
    vertices3D: [cylinderOrigo, cylinderEnd],
    drawType: "lines",
    elevation: {
      from: cylinderOrigo[2],
      to: cylinderEnd[2],
      horizontalDisplay: diff[2] < planarLength
    },
    text: [[`L ${length4.toFixed(3)}m   \u2300 ${(cylinderData.radius * 2 * unitToScale(product.units)).toFixed(3)}m   ${vertical ? "" : `% ${(Math.abs(diff[2] / planarLength) * 100).toFixed(2)}`}`]]
  });
  for (const halfEdgeIdx of loop.halfEdges) {
    const halfEdgeData = product.halfEdges[halfEdgeIdx];
    const edgeData = product.edges[halfEdgeData.edge];
    if (edgeData.virtual) {
      continue;
    }
    const edgeCurve = MeasureTool.geometryFactory.getCurve3DFromEdge(
      product,
      halfEdgeData.edge
    );
    if (edgeCurve) {
      const edge = {
        curve: edgeCurve,
        geometryTransformation: matFromInstance(
          product.instances[instanceIdx]
        ),
        instanceIndex: instanceIdx
      };
      drawParts.push({
        vertices3D: getEdgeStrip(edge, 1),
        drawType: "lines"
      });
    }
  }
  drawParts.push({ drawType: "text", vertices3D: [cylinderEnd], text: `Z: ${cylinderEnd[2].toFixed(3)}m` });
  drawParts.push({ drawType: "text", vertices3D: [cylinderOrigo], text: `Z: ${cylinderOrigo[2].toFixed(3)}m` });
  return drawParts;
}
async function getSurfaceDrawParts(product, instanceIdx, face) {
  const loop = product.loops[face.outerLoop];
  const drawParts = [];
  async function loopToVertices(loop2, isVoid) {
    const vertices = [];
    const hasLineOnEitherSide = [];
    const text2 = [];
    if (product) {
      let first = true;
      for (const halfEdgeIdx of loop2.halfEdges) {
        const halfEdgeData = product.halfEdges[halfEdgeIdx];
        const edgeCurve = MeasureTool.geometryFactory.getCurve3DFromEdge(
          product,
          halfEdgeData.edge
        );
        if (edgeCurve) {
          const isLine = edgeCurve.kind == "line" || edgeCurve.kind == "lineStrip";
          const edge = {
            curve: edgeCurve,
            geometryTransformation: matFromInstance(
              product.instances[instanceIdx]
            ),
            instanceIndex: instanceIdx
          };
          const edgeStrip = getEdgeStrip(edge, halfEdgeData.direction);
          const startIdx = first ? 0 : vertices.length - 1;
          if (!first && isLine) {
            hasLineOnEitherSide[startIdx];
          }
          let i = first ? 0 : 1;
          first = false;
          for (; i < edgeStrip.length; ++i) {
            vertices.push(edgeStrip[i]);
            hasLineOnEitherSide.push(isLine);
          }
        }
      }
    }
    if (vertices.length > 4 && (vertices.length < 15 || !isVoid)) {
      let prev = vec3_exports.sub(vec3_exports.create(), vertices[vertices.length - 2], vertices[0]);
      let next = vec3_exports.create();
      for (let i = 0; i < vertices.length - 1; ++i) {
        next = vec3_exports.sub(vec3_exports.create(), vertices[i + 1], vertices[i]);
        if (hasLineOnEitherSide[i]) {
          text2.push(vec3_exports.length(next).toFixed(3));
          const prevIdx = i == 0 ? vertices.length - 2 : i - 1;
          if (hasLineOnEitherSide[prevIdx] && hasLineOnEitherSide[i + 1]) {
            const angle3 = vec3_exports.angle(prev, next) * (180 / Math.PI);
            if (angle3 > 0.1) {
              drawParts.push({
                text: angle3.toFixed(1) + "\xB0",
                drawType: "angle",
                vertices3D: [vec3_exports.clone(vertices[i]), vec3_exports.clone(vertices[prevIdx]), vec3_exports.clone(vertices[i + 1])]
              });
            }
          }
        } else {
          text2.push("");
        }
        vec3_exports.negate(next, next);
        prev = next;
      }
    }
    return { vertices, text: text2 };
  }
  const text = [];
  const { vertices: outerVerts, text: outerTexts } = await loopToVertices(loop, false);
  text.push(outerTexts);
  const voids = [];
  if (face.innerLoops) {
    for (const innerLoopIdx of face.innerLoops) {
      const innerLoop = product.loops[innerLoopIdx];
      const { vertices: innerVerts, text: innerTexts } = await loopToVertices(innerLoop, true);
      text.push(innerTexts);
      voids.push({ vertices3D: innerVerts });
    }
  }
  drawParts.push({ vertices3D: outerVerts, drawType: "filled", voids, text: text.length > 0 ? text : void 0 });
  return drawParts;
}
async function getManholeDrawObjects(product, manhole) {
  const drawObjects = [];
  drawObjects.push({
    kind: "plane",
    parts: await getSurfaceDrawParts(product, manhole.top.entity.instanceIndex, manhole.internal.top)
  });
  drawObjects.push({
    kind: "plane",
    parts: await getSurfaceDrawParts(product, manhole.bottomOuter.entity.instanceIndex, manhole.internal.bottomOuter)
  });
  if (manhole.bottomInner && manhole.internal.bottomInner) {
    drawObjects.push({
      kind: "plane",
      parts: await getSurfaceDrawParts(product, manhole.bottomInner.entity.instanceIndex, manhole.internal.bottomInner)
    });
  }
  const outerCylinder = product.surfaces[manhole.internal.outer.surface];
  drawObjects.push({
    kind: "plane",
    parts: await getCylinderDrawParts(product, manhole.outer.entity.instanceIndex, outerCylinder, manhole.internal.outer)
  });
  if (manhole.internal.inner && manhole.inner) {
    const innerCylinder = product.surfaces[manhole.internal.inner.surface];
    drawObjects.push({
      kind: "plane",
      parts: await getCylinderDrawParts(product, manhole.inner.entity.instanceIndex, innerCylinder, manhole.internal.inner)
    });
  }
  return drawObjects;
}

// /projects/Novorender/ts/dist/measure/worker/collision.ts
async function getFaceToFaceCollisionValues(productA, faceIdxA, instanceIdxA, productB, faceIdxB, instanceIdxB, setting) {
  const faceDataA = productA.faces[faceIdxA];
  const surfaceDataA = productA.surfaces[faceDataA.surface];
  let surfaceA = {
    surf: MeasureTool.geometryFactory.getSurface(surfaceDataA, 1),
    instanceIdx: instanceIdxA,
    faceData: faceDataA,
    data: surfaceDataA,
    product: productA
  };
  const faceDataB = productB.faces[faceIdxB];
  const surfaceDataB = productB.surfaces[faceDataB.surface];
  let surfaceB = {
    surf: MeasureTool.geometryFactory.getSurface(surfaceDataB, 1),
    instanceIdx: instanceIdxB,
    faceData: faceDataB,
    data: surfaceDataB,
    product: productB
  };
  if (surfaceA.surf && surfaceB.surf) {
    if (surfaceA.surf.kind == "cylinder" && surfaceB.surf.kind == "cylinder") {
      if (!fullCircleCylinder(productA, faceDataA) || !fullCircleCylinder(productB, faceDataB)) {
        return void 0;
      }
      const cylinderA = surfaceA.data;
      const matA = matFromInstance(
        surfaceA.product.instances[surfaceA.instanceIdx]
      );
      const cylinderB = surfaceB.data;
      const matB = matFromInstance(
        surfaceB.product.instances[surfaceB.instanceIdx]
      );
      return getCylinderToCylnderCollisionValues(
        cylinderA,
        matA,
        surfaceA.product,
        surfaceA.faceData,
        unitToScale(surfaceA.product.units),
        cylinderB,
        matB,
        surfaceB.product,
        surfaceB.faceData,
        unitToScale(surfaceB.product.units),
        setting
      );
    }
  }
  return void 0;
}
function rayCyllinderCollision(ray, cylinderStart, cylinderDir, cylinderRad) {
  const parallel = vec3_exports.equals(ray.dir, cylinderDir);
  if (parallel) {
    return void 0;
  }
  const rc = vec3_exports.sub(vec3_exports.create(), ray.start, cylinderStart);
  const n = vec3_exports.cross(vec3_exports.create(), ray.dir, cylinderDir);
  const ln = vec3_exports.len(n);
  vec3_exports.normalize(n, n);
  const d = Math.abs(vec3_exports.dot(rc, n));
  if (d <= cylinderRad) {
    const o = vec3_exports.cross(vec3_exports.create(), rc, cylinderDir);
    const t = -vec3_exports.dot(o, n) / ln;
    const o2 = vec3_exports.cross(vec3_exports.create(), n, cylinderDir);
    vec3_exports.normalize(o2, o2);
    const s = Math.abs(Math.sqrt(cylinderRad * cylinderRad - d * d) / vec3_exports.dot(ray.dir, o2));
    const tIn = t - s;
    const tOut = t + s;
    const param = tIn < tOut ? tIn : tOut;
    const centerCol = vec3_exports.scaleAndAdd(vec3_exports.create(), ray.start, ray.dir, param);
    return centerCol;
  }
  return void 0;
}
async function getCylinderToCylnderCollisionValues(cylinderA, matA, productA, faceDataA, scaleA, cylinderB, matB, productB, faceDataB, scaleB, setting) {
  const tolerance = 0.5;
  const [cylinderStartA, cylinderEndA] = await cylinderCenterLine(
    productA,
    faceDataA,
    cylinderA,
    matA
  );
  const dirA = vec3_exports.sub(vec3_exports.create(), cylinderEndA, cylinderStartA);
  vec3_exports.normalize(dirA, dirA);
  const [cylinderStartB, cylinderEndB] = await cylinderCenterLine(
    productB,
    faceDataB,
    cylinderB,
    matB
  );
  const dirB = vec3_exports.sub(vec3_exports.create(), cylinderEndB, cylinderStartB);
  vec3_exports.normalize(dirB, dirB);
  const radB = cylinderB.radius * scaleB;
  const radA = cylinderA.radius * scaleA;
  const ray = { start: cylinderStartA, dir: dirA };
  if (vec3_exports.dist(ray.start, cylinderStartB) < vec3_exports.dist(cylinderEndA, cylinderStartB)) {
    ray.start = cylinderEndA;
    vec3_exports.negate(ray.dir, ray.dir);
  }
  if (Math.abs(vec3_exports.dot(ray.dir, dirB)) > 0.99) {
    return void 0;
  }
  const colCenter = rayCyllinderCollision(ray, cylinderStartB, dirB, radB);
  if (colCenter) {
    const cylLen = vec3_exports.dist(cylinderStartA, cylinderEndA) + tolerance;
    const p = vec4_exports.fromValues(ray.dir[0], ray.dir[1], ray.dir[2], -vec3_exports.dot(colCenter, ray.dir));
    if (Math.abs(vec4_exports.dot(p, vec4_exports.fromValues(ray.start[0], ray.start[1], ray.start[2], 1))) > cylLen) {
      return void 0;
    }
    if (!setting || setting?.cylinderMeasure === "center") {
      return { point: colCenter };
    }
    let side = vec3_exports.fromValues(1, 0, 0);
    if (vec3_exports.dot(ray.dir, side) === 1) {
      side = vec3_exports.fromValues(0, 0, 1);
    }
    const up = vec3_exports.cross(vec3_exports.create(), ray.dir, side);
    vec3_exports.normalize(up, up);
    const d = 1 / Math.abs(vec3_exports.dot(up, dirB));
    if (setting.cylinderMeasure === "top") {
      const top = vec3_exports.scaleAndAdd(vec3_exports.create(), colCenter, dirB, radA * d);
      return { point: top };
    }
    const bottom = vec3_exports.scaleAndAdd(vec3_exports.create(), colCenter, dirB, -radA * d);
    return { point: bottom };
  }
  return void 0;
}

// /projects/Novorender/ts/dist/measure/worker/snaps.ts
async function getPickInterface(product, objectId) {
  const edgeInstances = new Array(product.instances.length);
  const faceInstances = new Array(product.instances.length);
  const curveSegmentInstances = new Array(
    product.instances.length
  );
  for (let i = 0; i < product.instances.length; ++i) {
    let faceFunc2 = function(faceIdx) {
      faces2.push(faceIdx);
      if (product) {
        const face = product.faces[faceIdx];
        const loops = [face.outerLoop, ...face.innerLoops ?? []];
        for (const loopIdx of loops) {
          const loop = product.loops[loopIdx];
          for (const halfEdgeIdx of loop.halfEdges) {
            const halfEdge = product.halfEdges[halfEdgeIdx];
            edges2.push(halfEdge.edge);
          }
        }
      }
    };
    var faceFunc = faceFunc2;
    const instanceData = product.instances[i];
    const edges2 = new Array();
    const faces2 = new Array();
    if (typeof instanceData.geometry == "number") {
      crawlInstance(product, instanceData, faceFunc2);
    }
    const geometryData = product.geometries[instanceData.geometry];
    if (geometryData.compoundCurve) {
      curveSegmentInstances[i] = geometryData.compoundCurve;
    } else {
      curveSegmentInstances[i] = [];
    }
    edgeInstances[i] = edges2;
    faceInstances[i] = faces2;
  }
  const segments = [];
  for (let i = 0; i < curveSegmentInstances.length; ++i) {
    const instanceData = product.instances[i];
    const instanceMat = matFromInstance(instanceData);
    const worldToObject = mat4_exports.invert(mat4_exports.create(), instanceMat);
    const curves = [];
    for (const segmentIdx of curveSegmentInstances[i]) {
      const curve = MeasureTool.geometryFactory.getCurve3DFromSegment(
        product,
        segmentIdx
      );
      if (curve) {
        curves.push({ idx: segmentIdx, curve });
      }
    }
    if (curves.length > 0) {
      segments.push({ segments: curves, instanceIdx: i, worldToObject });
    }
  }
  const edges = [];
  for (let i = 0; i < edgeInstances.length; ++i) {
    const InstanceData = product.instances[i];
    const instanceMat = matFromInstance(InstanceData);
    const worldToObject = mat4_exports.invert(mat4_exports.create(), instanceMat);
    const curves = [];
    for (const edgeIdx of edgeInstances[i]) {
      const edgeData = product.edges[edgeIdx];
      if (edgeData.virtual) {
        continue;
      }
      const curve = MeasureTool.geometryFactory.getCurve3DFromEdge(
        product,
        edgeIdx,
        1
      );
      if (curve) {
        curves.push({ data: edgeData, idx: edgeIdx, curve });
      }
    }
    if (curves.length > 0) {
      edges.push({ instanceIdx: i, worldToObject, instanceMat, edges: curves });
    }
  }
  const faces = [];
  for (let i = 0; i < faceInstances.length; ++i) {
    const InstanceData = product.instances[i];
    const instanceMat = matFromInstance(InstanceData);
    const worldToObject = mat4_exports.invert(mat4_exports.create(), instanceMat);
    const surfaces = [];
    for (const faceIdx of faceInstances[i]) {
      const faceData = product.faces[faceIdx];
      const surfaceData = product.surfaces[faceData.surface];
      const surface = MeasureTool.geometryFactory.getSurface(surfaceData, 1);
      surfaces.push({ aabb: faceData.aabb, idx: faceIdx, surface });
    }
    faces.push({ instanceIdx: i, worldToObject, faces: surfaces, instanceMat });
  }
  return { objectId, edges, segments, faces, unitScale: unitToScale(product.units) };
}
function pick(pickInterface, position, tolerance) {
  const flippedPos = vec3_exports.copy(vec3_exports.create(), position);
  const edgeTolerance = tolerance.edge ? tolerance.edge / pickInterface.unitScale : void 0;
  const segmentTolerance = tolerance.segment ? tolerance.segment / pickInterface.unitScale : void 0;
  const faceTolerance = tolerance.face ? tolerance.face / pickInterface.unitScale : void 0;
  const pointTolerance = tolerance.point ? tolerance.point / pickInterface.unitScale : void 0;
  if (segmentTolerance) {
    for (const instanceSeg of pickInterface.segments) {
      const localPoint = vec3_exports.transformMat4(
        vec3_exports.create(),
        flippedPos,
        instanceSeg.worldToObject
      );
      for (const seg of instanceSeg.segments) {
        const t = seg.curve.invert(localPoint);
        const curvePoint = vec3_exports.create();
        seg.curve.eval(t, curvePoint, void 0);
        const dist4 = vec3_exports.dist(curvePoint, localPoint);
        if (dist4 < segmentTolerance) {
          return {
            entity: {
              ObjectId: pickInterface.objectId,
              drawKind: "curveSegment",
              pathIndex: seg.idx,
              instanceIndex: instanceSeg.instanceIdx,
              parameter: t
            },
            connectionPoint: curvePoint
          };
        }
      }
    }
  }
  let closestCandidate = void 0;
  let closestDistance = Number.MAX_VALUE;
  let pointSelected = false;
  if (edgeTolerance || pointTolerance) {
    let aabbTol = 0;
    if (edgeTolerance && pointTolerance) {
      aabbTol = pointTolerance > edgeTolerance ? pointTolerance : edgeTolerance;
    } else {
      aabbTol = edgeTolerance ? edgeTolerance : pointTolerance ? pointTolerance : 0;
    }
    for (const instanceEdge of pickInterface.edges) {
      const localPoint = vec3_exports.transformMat4(
        vec3_exports.create(),
        flippedPos,
        instanceEdge.worldToObject
      );
      for (const edge of instanceEdge.edges) {
        if (isInsideAABB(localPoint, edge.data.aabb, aabbTol)) {
          const t = edge.curve.invert(localPoint);
          const curvePoint = vec3_exports.create();
          if (edge.data.vertices && edge.curve.kind != "arc" && pointTolerance) {
            const distToStart = Math.abs(edge.data.parameterBounds[0] - t);
            if (distToStart < pointTolerance && distToStart < closestDistance) {
              edge.curve.eval(
                edge.data.parameterBounds[0],
                curvePoint,
                void 0
              );
              const actualDistance = vec3_exports.dist(curvePoint, localPoint);
              if (actualDistance < pointTolerance && actualDistance < closestDistance) {
                pointSelected = true;
                closestDistance = actualDistance;
                vec3_exports.transformMat4(curvePoint, curvePoint, instanceEdge.instanceMat);
                closestCandidate = {
                  entity: {
                    ObjectId: pickInterface.objectId,
                    drawKind: "vertex",
                    pathIndex: edge.data.vertices[0],
                    instanceIndex: instanceEdge.instanceIdx,
                    parameter: vec3_exports.clone(curvePoint)
                  },
                  connectionPoint: vec3_exports.clone(curvePoint)
                };
              }
              const distToEnd = Math.abs(edge.data.parameterBounds[1] - t);
              if (distToEnd < pointTolerance && distToEnd < closestDistance) {
                edge.curve.eval(
                  edge.data.parameterBounds[1],
                  curvePoint,
                  void 0
                );
                const actualDistance2 = vec3_exports.dist(curvePoint, localPoint);
                if (actualDistance2 < pointTolerance && actualDistance2 < closestDistance) {
                  pointSelected = true;
                  closestDistance = actualDistance2;
                  vec3_exports.transformMat4(curvePoint, curvePoint, instanceEdge.instanceMat);
                  closestCandidate = {
                    entity: {
                      ObjectId: pickInterface.objectId,
                      drawKind: "vertex",
                      pathIndex: edge.data.vertices[1],
                      instanceIndex: instanceEdge.instanceIdx,
                      parameter: vec3_exports.clone(curvePoint)
                    },
                    connectionPoint: vec3_exports.clone(curvePoint)
                  };
                }
              }
            }
          }
          if (!pointSelected && edgeTolerance) {
            edge.curve.eval(t, curvePoint, void 0);
            const dist4 = vec3_exports.dist(curvePoint, localPoint);
            if (dist4 < edgeTolerance && dist4 < closestDistance) {
              closestDistance = dist4;
              vec3_exports.transformMat4(curvePoint, curvePoint, instanceEdge.instanceMat);
              closestCandidate = {
                entity: {
                  ObjectId: pickInterface.objectId,
                  drawKind: "edge",
                  pathIndex: edge.idx,
                  instanceIndex: instanceEdge.instanceIdx,
                  parameter: t
                },
                connectionPoint: curvePoint
              };
            }
          }
        }
      }
    }
  }
  if (closestCandidate) {
    return closestCandidate;
  }
  if (faceTolerance) {
    for (const faceInstance of pickInterface.faces) {
      const localPoint = vec3_exports.transformMat4(
        vec3_exports.create(),
        flippedPos,
        faceInstance.worldToObject
      );
      for (const face of faceInstance.faces) {
        if (isInsideAABB(localPoint, face.aabb, faceTolerance)) {
          const uv = vec2_exports.create();
          face.surface.invert(uv, localPoint);
          const surfacePoint = vec3_exports.create();
          face.surface.evalPosition(surfacePoint, uv);
          const dist4 = vec3_exports.dist(surfacePoint, localPoint);
          if (dist4 < closestDistance && dist4 < faceTolerance) {
            vec3_exports.transformMat4(surfacePoint, surfacePoint, faceInstance.instanceMat);
            closestCandidate = {
              entity: {
                ObjectId: pickInterface.objectId,
                drawKind: "face",
                pathIndex: face.idx,
                instanceIndex: faceInstance.instanceIdx,
                parameter: uv
              },
              connectionPoint: surfacePoint
            };
            closestDistance = dist4;
          }
        }
      }
    }
  }
  return closestCandidate;
}

// /projects/Novorender/ts/dist/measure/worker/roads/scene.ts
var RoadTool = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    const crossUrl = baseUrl;
    crossUrl.pathname += "road/";
    this.downloader = new Downloader(crossUrl);
  }
  data = /* @__PURE__ */ new Map();
  downloader;
  findShoulderIndex(codes) {
    let leftShoulder = 0;
    let rightShoulder = 0;
    let handleLeft = true;
    for (let i = 0; i < codes.length; ++i) {
      const code = codes[i];
      if (code == 10) {
        handleLeft = false;
      }
      if (code == 2) {
        if (handleLeft) {
          leftShoulder = i;
        } else {
          rightShoulder = i;
          break;
        }
      }
    }
    return { leftShoulder, rightShoulder };
  }
  async downloadSections(name) {
    try {
      return await this.downloader.downloadJson(name);
    } catch {
      return null;
    }
  }
  async getCrossSections(name) {
    if (this.data.size > 20) {
      this.data.clear();
    }
    let crossSection = this.data.get(name);
    if (crossSection === void 0) {
      crossSection = await this.downloadSections(`${name}.json`);
      this.data.set(name, crossSection);
    }
    return crossSection ?? void 0;
  }
  async getCrossSection(name, param) {
    const crossSections = await this.getCrossSections(name);
    if (crossSections) {
      const { intervals, sections, labels, codes } = crossSections;
      let left = 0;
      let right = intervals.length - 1;
      const sectionFromIndex = (index) => {
        if (index !== 0 && labels[sections[index - 1].l].length === 1) {
          return void 0;
        }
        let pts;
        let centerDir;
        const sec = sections[index];
        const centerIdx = crossSections.codes[sec.l].findIndex((c) => c == 10);
        const currCenter = sec.p[centerIdx];
        if (index == 0) {
          pts = sec.p;
          const nextSec = sections[index + 1];
          const nextCenterIdx = nextSec.l == sec.l ? centerIdx : crossSections.codes[nextSec.l].findIndex((c) => c == 10);
          const nextCenter = nextSec.p[nextCenterIdx];
          centerDir = vec3_exports.sub(vec3_exports.create(), nextCenter, currCenter);
          vec3_exports.normalize(centerDir, centerDir);
        } else {
          let prevCenter = vec3_exports.create();
          let prevSec;
          let prevIdx = 0;
          do {
            ++prevIdx;
            prevSec = sections[index - prevIdx];
            const nextCenterIdx = prevSec.l == sec.l ? centerIdx : crossSections.codes[prevSec.l].findIndex((c) => c == 10);
            prevCenter = prevSec.p[nextCenterIdx];
          } while (vec3_exports.exactEquals(currCenter, prevCenter) && index - prevIdx > 0);
          const internalParam = Math.abs(param - intervals[index - prevIdx]);
          if (internalParam > 10) {
            return void 0;
          }
          if (vec3_exports.exactEquals(currCenter, prevCenter)) {
            return void 0;
          }
          centerDir = vec3_exports.sub(vec3_exports.create(), currCenter, prevCenter);
          vec3_exports.normalize(centerDir, centerDir);
          pts = prevSec.l == sec.l ? prevSec.p.map((p, i) => {
            const nextP = sec.p[i];
            const dir = vec3_exports.sub(vec3_exports.create(), nextP, p);
            vec3_exports.normalize(dir, dir);
            return vec3_exports.scaleAndAdd(vec3_exports.create(), p, dir, internalParam);
          }) : sec.p;
        }
        const up = vec3_exports.fromValues(0, 0, 1);
        const right2 = vec3_exports.cross(vec3_exports.create(), up, centerDir);
        vec3_exports.normalize(right2, right2);
        vec3_exports.cross(centerDir, right2, up);
        vec3_exports.normalize(centerDir, centerDir);
        const mat = mat3_exports.fromValues(
          right2[0],
          right2[1],
          right2[2],
          up[0],
          up[1],
          up[2],
          centerDir[0],
          centerDir[1],
          centerDir[2]
        );
        const points2D = pts.map((p) => {
          const _p = vec3_exports.transformMat3(vec3_exports.create(), p, mat);
          return vec2_exports.fromValues(_p[0], _p[1]);
        });
        const points = pts.map((p) => {
          return vec3_exports.scaleAndAdd(vec3_exports.create(), p, centerDir, 1e-3);
        });
        const sectionCodes = codes[sec.l];
        const { leftShoulder, rightShoulder } = this.findShoulderIndex(sectionCodes);
        const cp = vec3_exports.clone(points[centerIdx]);
        const lp = vec3_exports.clone(points[leftShoulder]);
        const rp = vec3_exports.clone(points[rightShoulder]);
        const cp2d = vec2_exports.fromValues(cp[0], cp[1]);
        const lp2d = vec2_exports.fromValues(lp[0], lp[1]);
        const rp2d = vec2_exports.fromValues(rp[0], rp[1]);
        const slopeL = Math.abs(cp[2] - lp[2]) / vec2_exports.dist(cp2d, lp2d);
        const slopeR = Math.abs(cp[2] - rp[2]) / vec2_exports.dist(cp2d, rp2d);
        const slopes = {
          left: { slope: slopeL, start: lp, end: cp },
          right: { slope: slopeR, start: cp, end: rp }
        };
        return { points, labels: labels[sec.l], points2D, slopes, codes: sectionCodes };
      };
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const midParam = intervals[mid];
        if (mid === intervals.length - 1) {
          if (midParam < param) {
            return sectionFromIndex(mid);
          }
          return void 0;
        }
        if (Math.abs(midParam - param) < 1e-3) {
          return sectionFromIndex(mid);
        }
        if (param < midParam) {
          right = mid - 1;
        } else {
          const nextParam = intervals[mid + 1];
          if (param < nextParam) {
            return sectionFromIndex(mid + 1);
          }
          left = mid + 1;
        }
      }
    }
  }
  async getRoadProfiles(name) {
    const crossSections = await this.getCrossSections(name);
    if (crossSections) {
      if (crossSections.heightmaps.length != 0) {
        const profiles = [];
        profiles.push({ name: crossSections.name, elevations: crossSections.centerLine.map((p) => p[2]) });
        for (const map of crossSections.heightmaps) {
          profiles.push(map);
        }
      }
    }
    return void 0;
  }
  async getCrossSlope(name) {
    const crossSections = await this.getCrossSections(name);
    if (crossSections) {
      const left = [];
      const right = [];
      crossSections.sections.forEach((section) => {
        const sectionCodes = crossSections.codes[section.l];
        const { leftShoulder, rightShoulder } = this.findShoulderIndex(sectionCodes);
        const centerIdx = sectionCodes.findIndex((c) => c == 10);
        const cp = vec3_exports.clone(section.p[centerIdx]);
        const lp = vec3_exports.clone(section.p[leftShoulder]);
        const rp = vec3_exports.clone(section.p[rightShoulder]);
        const cp2d = vec2_exports.fromValues(cp[0], cp[1]);
        const lp2d = vec2_exports.fromValues(lp[0], lp[1]);
        const rp2d = vec2_exports.fromValues(rp[0], rp[1]);
        left.push(cp[2] - lp[2] / vec2_exports.dist(cp2d, lp2d));
        right.push(cp[2] - rp[2] / vec2_exports.dist(cp2d, rp2d));
      });
      return { intervals: crossSections.intervals, left, right };
    }
    return void 0;
  }
  // async getRoadProfiles(name: string): Promise<RoadProfiles | undefined> {
  //     const crossSections = await this.getCrossSections(name);
  //     if (crossSections) {
  //         const profiles: RoadProfile[] = [];
  //         const addOrAppend = (codes: number[], points: ReadonlyVec2[][], labels: string[]) => {
  //             for (let i = 0; i < codes.length; ++i) {
  //                 const side = codes[i] == 10 ? "center" : labels[i][0] === '-' ? "left" : "right";
  //                 const p = profiles.find((p) => p.code == codes[i] && p.side == side && p.label == labels[i]);
  //                 if (p) {
  //                     p.points.push(...points[i]);
  //                 } else {
  //                     profiles.push({ code: codes[i], label: labels[i], points: points[i], side });
  //                 }
  //             }
  //         }
  //         let currentCodes = crossSections.codes[0];
  //         let currentLabels = crossSections.labels[0];
  //         let currentPoints: ReadonlyVec2[][] = [];
  //         let currentLabelsIdx = 0;
  //         for (let i = 0; i < crossSections.intervals.length; ++i) {
  //             const section = crossSections.sections[i];
  //             if (currentLabelsIdx != section.l) {
  //                 addOrAppend(currentCodes, currentPoints, currentLabels);
  //                 currentCodes = crossSections.codes[section.l];
  //                 currentLabels = crossSections.labels[section.l];
  //                 currentLabelsIdx = section.l
  //                 currentPoints = [];
  //             }
  //             if (currentPoints.length == 0) {
  //                 for (let j = 0; j < section.p.length; ++j) {
  //                     currentPoints.push([]);
  //                 }
  //             }
  //             const currentParam = crossSections.intervals[i];
  //             for (let j = 0; j < section.p.length; ++j) {
  //                 currentPoints[j].push(vec2.fromValues(currentParam, section.p[j][2]));
  //             }
  //         }
  //         addOrAppend(currentCodes, currentPoints, currentLabels);
  //         return { name: crossSections.centerLine, profiles };
  //     }
  // }
};

// /projects/Novorender/ts/dist/measure/worker/scene.ts
common_exports.setMatrixArrayType(Array);
var epsilon3 = 1e-4;
var MeasureTool = class _MeasureTool {
  downloader = void 0;
  crossSectionTool = void 0;
  data = /* @__PURE__ */ new Map();
  snapObjects = new Array();
  nextSnapIdx = 0;
  static geometryFactory = void 0;
  idToHash;
  constructor() {
  }
  lookupHash(id) {
    const { idToHash } = this;
    if (idToHash && id < idToHash.length / 16) {
      const offset = id * 16;
      const slice = idToHash.subarray(offset, offset + 16);
      return [...slice].map((b) => {
        const s = b.toString(16);
        return s.length < 2 ? s.length == 1 ? "0" + s : "00" : s;
      }).join("").toUpperCase();
    }
    return void 0;
  }
  async init(wasm) {
    _MeasureTool.geometryFactory = await createGeometryFactory(wasm);
  }
  async loadScene(baseUrl, lutPath) {
    const url = new URL(baseUrl);
    const idx = lutPath.indexOf("/") + 1;
    if (idx > 0) {
      const dir = lutPath.substring(0, idx);
      url.pathname += dir;
      lutPath = lutPath.substring(idx);
    }
    this.downloader = new Downloader(url);
    if (lutPath.length === 0) {
      lutPath = "object_id_to_brep_hash";
    }
    try {
      this.idToHash = new Uint8Array(await this.downloader.downloadArrayBuffer(lutPath));
    } catch {
      this.idToHash = void 0;
    }
    this.crossSectionTool = new RoadTool(new URL(baseUrl));
    this.data.clear();
    this.snapObjects.length = 0;
  }
  async getSnapInterface(id, product) {
    for (const pickInterface of this.snapObjects) {
      if (pickInterface.objectId == id) {
        return pickInterface;
      }
    }
    if (product) {
      if (this.nextSnapIdx == 6) {
        this.nextSnapIdx = 0;
      }
      const snapInterface = await getPickInterface(product, id);
      this.snapObjects[this.nextSnapIdx++] = snapInterface;
      return snapInterface;
    }
  }
  async downloadBrep(id) {
    const { idToHash } = this;
    if (idToHash) {
      const hash = this.lookupHash(id);
      try {
        return hash ? await this.downloader.downloadJson(hash) : null;
      } catch {
        return null;
      }
    } else {
      try {
        return await this.downloader.downloadJson(`${id}.json`);
      } catch {
        return null;
      }
    }
  }
  async getProduct(id) {
    let product = this.data.get(id);
    if (product === void 0) {
      product = await this.downloadBrep(id);
      if (product && product.instances === void 0) {
        this.data.set(id, null);
        return void 0;
      }
      this.data.set(id, product);
    }
    return product ?? void 0;
  }
  async isBrepGenerated(id) {
    const product = await this.getProduct(id);
    if (product) {
      return product.version !== void 0;
    }
    return false;
  }
  async getCameraValuesFromFace(id, faceIdx, instanceIdx, cameraDir) {
    const product = await this.getProduct(id);
    if (product) {
      return extractCameraValuesFromFace(
        product,
        faceIdx,
        instanceIdx,
        cameraDir
      );
    }
    return void 0;
  }
  async getFaces(id, viewWorldMatrix) {
    const product = await this.getProduct(id);
    if (product) {
      const worldViewMatrix = mat4_exports.create();
      mat4_exports.invert(worldViewMatrix, viewWorldMatrix);
      const faces = _MeasureTool.geometryFactory.getFaces(product);
      const paths = getBrepFaces(faces, worldViewMatrix).filter(
        (p) => p.path.length > 0
      );
      paths.sort((a, b) => a.centerDepth - b.centerDepth);
      return paths;
    }
    return [];
  }
  async getProductObject(productId) {
    const product = await this.getProduct(productId);
    if (product) {
      return toParametricProduct(productId, product);
    }
    return void 0;
  }
  async getSnaps(productId) {
    const product = await this.getProduct(productId);
    if (product) {
    }
    return void 0;
  }
  async getParameterBoundsForCurve(id, pathIdx, pathKind) {
    const product = await this.getProduct(id);
    if (product) {
      const parameterData = pathKind == "edge" ? product.edges[pathIdx] : product.curveSegments[pathIdx];
      const scale6 = unitToScale(product.units);
      return {
        start: parameterData.parameterBounds[0] * scale6,
        end: parameterData.parameterBounds[1] * scale6
      };
    }
    return void 0;
  }
  async evalCurve(id, pathIdx, instanceIdx, parameter, pathKind) {
    const product = await this.getProduct(id);
    if (product) {
      return evalCurve(product, pathIdx, instanceIdx, parameter, pathKind);
    }
    return void 0;
  }
  async getCylinderCurve(id, faceIdx, instanceIdx, setting) {
    const product = await this.getProduct(id);
    if (product) {
      const faceData = product.faces[faceIdx];
      const scale6 = unitToScale(product.units);
      const surfaceData = product.surfaces[faceData.surface];
      const surface = _MeasureTool.geometryFactory.getSurface(
        surfaceData,
        faceData.facing,
        scale6
      );
      if (surface.kind == "cylinder") {
        const cylinderData = surfaceData;
        const mat = matFromInstance(product.instances[instanceIdx]);
        const [cylinderOrigo, cylinderEnd] = await cylinderCenterLine(
          product,
          faceData,
          cylinderData,
          mat,
          setting ? setting.cylinderMeasure : "center"
        );
        return [
          { start: 0, end: vec3_exports.dist(cylinderOrigo, cylinderEnd) },
          [cylinderOrigo, cylinderEnd]
        ];
      }
    }
    return void 0;
  }
  async pickEntity(id, position, tolerance) {
    const product = await this.getProduct(id);
    if (product) {
      const snapInterface = await this.getSnapInterface(id, product);
      if (snapInterface) {
        const tol = tolerance ?? { edge: 0.032, segment: 0.12, face: 0.07, point: 0.032 };
        const pickedEntity = pick(snapInterface, position, tol);
        if (pickedEntity) {
          return { entity: pickedEntity.entity, status: "loaded", connectionPoint: pickedEntity.connectionPoint };
        }
      }
    }
    return {
      entity: { ObjectId: id, parameter: position, drawKind: "vertex" },
      status: "missing"
    };
  }
  async pickEntityOnCurrentObject(id, position, tolerance) {
    const product = this.data.get(id);
    if (product === null) {
      return {
        entity: void 0,
        status: "missing"
      };
    }
    const snapInterface = await this.getSnapInterface(id, void 0);
    if (snapInterface) {
      const p = pick(snapInterface, position, tolerance);
      return { entity: p?.entity, status: "loaded", connectionPoint: p?.connectionPoint };
    }
    return {
      entity: void 0,
      status: "unknown"
    };
  }
  async getEdges(id, viewWorldMatrix) {
    const product = await this.getProduct(id);
    if (product) {
      const worldViewMatrix = mat4_exports.create();
      mat4_exports.invert(worldViewMatrix, viewWorldMatrix);
      const edges = _MeasureTool.geometryFactory.getEdges(product);
      const paths = getBrepEdges(edges, worldViewMatrix).filter(
        (p) => p.path.length > 0
      );
      return paths;
    }
    return [];
  }
  async getPaths(id, worldViewMatrix) {
    const product = await this.getProduct(id);
    if (product) {
      const faces = _MeasureTool.geometryFactory.getFaces(product);
      const facePaths = getBrepFaces(faces, worldViewMatrix).filter(
        (p) => p.path.length > 0
      );
      facePaths.sort((a, b) => a.centerDepth - b.centerDepth);
      const edges = _MeasureTool.geometryFactory.getEdges(product);
      const edgePaths = getBrepEdges(edges, worldViewMatrix).filter(
        (p) => p.path.length > 0
      );
      return [...facePaths, ...edgePaths];
    }
    return [];
  }
  async getCurveSegmentEntity(id) {
    const product = await this.getProduct(id);
    if (product) {
      if (product.curveSegments && product.curveSegments.length > 0) {
        if (product.curveSegments.length === 1) {
          return {
            ObjectId: id,
            drawKind: "curveSegment",
            pathIndex: 0,
            instanceIndex: 0,
            parameter: 0
          };
        }
      }
    }
  }
  async getTesselatedEdge(id, edgeIdx, instanceIdx) {
    const product = await this.getProduct(id);
    if (product) {
      const edgeCurve = _MeasureTool.geometryFactory.getCurve3DFromEdge(
        product,
        edgeIdx
      );
      if (edgeCurve) {
        const edge = {
          curve: edgeCurve,
          geometryTransformation: matFromInstance(
            product.instances[instanceIdx]
          ),
          instanceIndex: instanceIdx
        };
        return getEdgeStrip(edge, 1);
      }
    }
    return [];
  }
  tesselateCurveSegment(product, curveSeg, instanceIdx) {
    if (curveSeg) {
      const curve = {
        curve: curveSeg,
        geometryTransformation: matFromInstance(
          product.instances[instanceIdx]
        ),
        instanceIndex: instanceIdx
      };
      return getEdgeStrip(curve, 1);
    }
    return [];
  }
  async getCurveFromSegment(id, curveSegmentIdx) {
    const product = await this.getProduct(id);
    if (product) {
      const curveSeg = _MeasureTool.geometryFactory.getCurve3DFromSegment(
        product,
        curveSegmentIdx
      );
      return curveSeg;
    }
  }
  async getCurveSegmentDrawObject(id, curveSegmentIdx, instanceIdx, segmentLabelInterval) {
    const product = await this.getProduct(id);
    if (product) {
      const curve = await this.getCurveFromSegment(id, curveSegmentIdx);
      if (curve) {
        const wsVertices = await this.tesselateCurveSegment(
          product,
          curve,
          instanceIdx
        );
        const drawObject = {
          kind: "curveSegment",
          parts: [{ vertices3D: wsVertices, drawType: "lines" }]
        };
        if (segmentLabelInterval && segmentLabelInterval > 0) {
          const texts = [];
          const vertices3D = [];
          for (let p = curve.beginParam; p < curve.endParam; p += segmentLabelInterval) {
            const pos = vec3_exports.create();
            curve.eval(p, pos, void 0);
            vertices3D.push(pos);
            texts.push(`P = ${p.toFixed(0)}`);
          }
          drawObject.parts.push({ drawType: "text", vertices3D, text: [texts] });
          return { ...drawObject, kind: "complex" };
        }
        return drawObject;
      }
    }
    return {
      kind: "curveSegment",
      parts: [{ vertices3D: [], drawType: "lines" }]
    };
  }
  async curveSegmentProfile(id, curveSegmentIdx, instanceIdx) {
    const product = await this.getProduct(id);
    if (product) {
      const curveSeg = _MeasureTool.geometryFactory.getCurve3DFromSegment(
        product,
        curveSegmentIdx
      );
      if (curveSeg) {
        return getCurveSegmentProfile(product, curveSeg, instanceIdx);
      }
    }
    return void 0;
  }
  async cylinderProfile(id, faceIdx, instanceIdx, setting) {
    const product = await this.getProduct(id);
    if (product) {
      return await getCylinderProfile(product, faceIdx, instanceIdx, setting);
    }
    return void 0;
  }
  async multiSelectProfile(products, setting) {
    const centerLines = [];
    for (const id of products) {
      const product = await this.getProduct(id);
      if (product) {
        if (product.curveSegments && product.curveSegments.length > 0) {
          if (product.curveSegments.length === 1 && products.length === 1) {
            const segProfile = await this.curveSegmentProfile(id, 0, 0);
            if (segProfile) {
              return segProfile;
            }
          } else {
            return "Multiple segments in profile";
          }
        }
        await addCenterLinesFromCylinders(
          product,
          centerLines,
          unitToScale(product.units),
          setting
        );
      }
    }
    const lineStrip = reduceLineStrip(centerLinesToLinesTrip(centerLines));
    if (lineStrip.length > 1) {
      const profile = getProfile(lineStrip, void 0, void 0);
      return reduceProfile(profile);
    }
    return void 0;
  }
  async getLineStripFromCylinders(products, setting) {
    const lineStrip = await this.cylindersToLinestrip(products, setting);
    for (const p of lineStrip) {
    }
    return lineStrip;
  }
  async cylindersToLinestrip(products, setting) {
    const centerLines = [];
    for (const id of products) {
      const product = await this.getProduct(id);
      if (product) {
        await addCenterLinesFromCylinders(
          product,
          centerLines,
          unitToScale(product.units),
          setting
        );
      }
    }
    return reduceLineStrip(centerLinesToLinesTrip(centerLines));
  }
  async getFaceDrawObject(id, faceIdx, instanceIdx, setting) {
    const product = await this.getProduct(id);
    if (product) {
      const face = product.faces[faceIdx];
      const surface = product.surfaces[face.surface];
      let drawParts = [];
      const kind = surface.kind == "cylinder" ? "cylinder" : "plane";
      if (surface.kind == "cylinder") {
        drawParts = await getCylinderDrawParts(product, instanceIdx, surface, face, setting);
      } else {
        drawParts = await getSurfaceDrawParts(product, instanceIdx, face);
      }
      return { kind, parts: drawParts };
    }
    return void 0;
  }
  async edgeToEdgeMeasure(idA, edgeIdxA, instanceIdxA, idB, edgeIdxB, instanceIdxB) {
    const productA = await this.getProduct(idA);
    const productB = await this.getProduct(idB);
    if (productA && productB) {
      return await getEdgeToEdgeMeasureValues(
        productA,
        edgeIdxA,
        instanceIdxA,
        productB,
        edgeIdxB,
        instanceIdxB
      );
    }
  }
  async edgeToPointMeasure(id, edgeIdx, instanceIdx, point) {
    const product = await this.getProduct(id);
    if (product) {
      return await edgeToPointMeasureValues(
        product,
        edgeIdx,
        instanceIdx,
        point
      );
    }
  }
  async segmentToPointMeasure(id, segIdx, instanceIdx, point) {
    const product = await this.getProduct(id);
    if (product) {
      return await segmentToPointMeasureValues(
        product,
        segIdx,
        instanceIdx,
        point
      );
    }
  }
  async faceToPointMeasure(id, faceIdx, instanceIdx, point, setting) {
    const product = await this.getProduct(id);
    if (product) {
      return await faceToPointMeasureValues(
        product,
        faceIdx,
        instanceIdx,
        point,
        unitToScale(product.units),
        setting
      );
    }
  }
  async edgeToFaceMeasure(idA, edgeIdx, edgeInstanceIdx, idB, faceIdx, faceInstanceIdx, setting) {
    const productA = await this.getProduct(idA);
    const productB = await this.getProduct(idB);
    if (productA && productB) {
      return await getEdgeToFaceMeasureValues(
        productA,
        edgeIdx,
        edgeInstanceIdx,
        productB,
        faceIdx,
        faceInstanceIdx,
        setting
      );
    }
    return void 0;
  }
  async faceToFaceMeasure(idA, faceIdxA, instanceIdxA, idB, faceIdxB, instanceIdxB, settingA, settingB) {
    const productA = await this.getProduct(idA);
    const productB = await this.getProduct(idB);
    if (productA && productB) {
      return await getFaceToFaceMeasureValues(
        productA,
        faceIdxA,
        instanceIdxA,
        productB,
        faceIdxB,
        instanceIdxB,
        settingA,
        settingB
      );
    }
    return void 0;
  }
  async segmentToSegmentMeasure(idA, segIdxA, instanceIdxA, idB, segIdxB, instanceIdxB) {
    const productA = await this.getProduct(idA);
    const productB = await this.getProduct(idB);
    if (productA && productB) {
      return await getSegmentToSegmentMeasureValues(
        productA,
        segIdxA,
        instanceIdxA,
        productB,
        segIdxB,
        instanceIdxB
      );
    }
    return void 0;
  }
  async segmentToEdgeMeasure(idA, segIdx, segInstanceIdx, idB, edgeIdx, edgeInstanceIdx) {
    const productA = await this.getProduct(idA);
    const productB = await this.getProduct(idB);
    if (productA && productB) {
      return await getSegmentToEdgeMeasureValues(
        productA,
        segIdx,
        segInstanceIdx,
        productB,
        edgeIdx,
        edgeInstanceIdx
      );
    }
    return void 0;
  }
  async segmentToFaceMeasure(idA, segIdx, segInstanceIdx, idB, faceIdx, faceInstanceIdx, setting) {
    const productA = await this.getProduct(idA);
    const productB = await this.getProduct(idB);
    if (productA && productB) {
      return await getSegmentToFaceMeasureValues(
        productA,
        segIdx,
        segInstanceIdx,
        productB,
        faceIdx,
        faceInstanceIdx,
        setting
      );
    }
    return void 0;
  }
  async getCurveValues(id, pathIdx, instanceIdx, pathKind) {
    const product = await this.getProduct(id);
    if (product) {
      return extractCurveValues(product, pathIdx, instanceIdx, pathKind);
    }
  }
  async getFaceValues(id, faceIdx, instanceIdx, setting) {
    const product = await this.getProduct(id);
    if (product) {
      return extractFaceValues(id, product, faceIdx, instanceIdx, setting);
    }
  }
  async getManholeValues(id) {
    const product = await this.getProduct(id);
    if (product) {
      return manholeMeasure(product, id);
    }
    return void 0;
  }
  async getManholeDrawObject(entity) {
    const product = await this.getProduct(entity.ObjectId);
    if (product) {
      return getManholeDrawObjects(product, entity);
    }
    return [];
  }
  async swapCylinder(id, faceIdx, instanceIdx, to) {
    const product = await this.getProduct(id);
    if (product) {
      return swapCylinderImpl(product, faceIdx, instanceIdx, to);
    }
  }
  async faceToFaceCollision(idA, faceIdxA, instanceIdxA, idB, faceIdxB, instanceIdxB, setting) {
    const productA = await this.getProduct(idA);
    const productB = await this.getProduct(idB);
    if (productA && productB) {
      return await getFaceToFaceCollisionValues(
        productA,
        faceIdxA,
        instanceIdxA,
        productB,
        faceIdxB,
        instanceIdxB,
        setting
      );
    }
    return void 0;
  }
  //Road stuff
  async getRoadProfile(roadId) {
    return await this.crossSectionTool.getRoadProfiles(roadId);
  }
  async getRoadCrossSlope(roadId) {
    return await this.crossSectionTool.getCrossSlope(roadId);
  }
  async getCrossSection(roadId, profileNumber) {
    return await this.crossSectionTool.getCrossSection(roadId, profileNumber);
  }
};

// /projects/Novorender/ts/dist/measure/worker/service.ts
var Service = class {
  scriptUrl;
  initialize(scriptUrl) {
    this.scriptUrl = scriptUrl;
  }
  terminate() {
    if ("DedicatedWorkerGlobalScope" in self) {
      self.close();
    }
  }
  createMeasureTool() {
    const tool = new MeasureTool();
    return proxy(tool);
  }
};
var service = new Service();
expose(service);
/*! Bundled license information:

comlink/dist/esm/comlink.mjs:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: Apache-2.0
   *)
*/
//# sourceMappingURL=measureWorker.js.map
