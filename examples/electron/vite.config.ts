import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: [
    {
      dts: false,
      shims: true,
      platform: 'node',
      target: 'node24.16',
      format: 'esm',
      minify: false,
      deps: {
        neverBundle: ['electron'],
      },
      entry: {
        main: 'src/main.ts',
      },
    },
    {
      dts: false,
      shims: true,
      platform: 'node',
      target: 'node24.16',
      format: 'cjs',
      minify: false,
      deps: {
        neverBundle: ['electron'],
      },
      entry: {
        preload: 'src/preload.ts',
      },
    },
  ],
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  server: {
    port: 7212,
  },
});
