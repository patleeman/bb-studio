export interface FakeGl {
  gl: WebGLRenderingContext;
  calls: { name: string; args: unknown[] }[];
  draws(): number;
  uniform(name: string): unknown[] | undefined;
  failCompile(log: string): void;
  setPixels(fill: (index: number) => [number, number, number, number]): void;
}

export function fakeWebGl(): FakeGl {
  const calls: { name: string; args: unknown[] }[] = [];
  const locations = new Map<object, string>();
  const values = new Map<string, unknown[]>();
  let compileLog: string | null = null;
  let pixels: ((index: number) => [number, number, number, number]) | null = null;
  const constants: Record<string, number> = { COMPILE_STATUS: 1, LINK_STATUS: 2, VERTEX_SHADER: 3, FRAGMENT_SHADER: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8, RGBA: 9, UNSIGNED_BYTE: 10 };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    getShaderParameter: () => compileLog === null,
    getShaderInfoLog: () => compileLog ?? "",
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    getUniformLocation: (_program, name) => { const location = {}; locations.set(location, String(name)); return location; },
    readPixels: (...args) => {
      const out = args[6] as Uint8Array;
      if (pixels) for (let at = 0; at < out.length / 4; at += 1) out.set(pixels(at), at * 4);
    },
  };
  const gl = new Proxy({}, {
    get(_target, key) {
      if (typeof key !== "string") return undefined;
      if (key in constants) return constants[key];
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        if (key.startsWith("uniform") && args[0] && locations.has(args[0] as object)) values.set(locations.get(args[0] as object)!, args.slice(1));
        return methods[key]?.(...args);
      };
    },
  }) as WebGLRenderingContext;
  return {
    gl,
    calls,
    draws: () => calls.filter((call) => call.name === "drawArrays").length,
    uniform: (name) => values.get(name),
    failCompile: (log) => { compileLog = log; },
    setPixels: (fill) => { pixels = fill; },
  };
}
