import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/bin.ts',
  format: 'esm',
  platform: 'node',
  target: 'node22.19',
  outDir: 'dist',
  clean: true,
  dts: false,
  // package.json "type": "module" already makes .js ESM; .mjs would break the published bin path.
  fixedExtension: false,
});
