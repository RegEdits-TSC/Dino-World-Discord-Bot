// ffmpeg-static ships its own types/index.d.ts, but NodeNext's CJS/ESM
// interop resolves that file's `export default` to the module namespace
// object, not the string it actually is at runtime. This shim overrides it
// with the correct shape — do not delete it as redundant.
declare module 'ffmpeg-static' {
  const path: string | null;
  export default path;
}
