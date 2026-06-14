import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: [
    {
      entry: {
        index: './src/index.ts',
        client: './src/client/index.ts',
        event: './src/event/index.ts',
        test: './src/host/test.ts',
      },
      platform: 'node',
      format: 'esm',
      dts: true,
    },
  ],
  test: {
    typecheck: {
      enabled: true,
    },
    include: ['./src/**/__tests__/**/*.test.ts', './src/**/__tests__/**/*.test-d.ts'],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
