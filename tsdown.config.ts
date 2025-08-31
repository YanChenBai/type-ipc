import { defineConfig } from 'tsdown'

const externalModules = [
  'electron',
  '@sinclair/typebox',
  '@sinclair/typebox/value',
]

export default defineConfig([
  {
    entry: [
      './src/renderer.ts',
      './src/preload.ts',
      './src/index.ts',
    ],
    platform: 'browser',
    dts: true,
    external: externalModules,
  },
  {
    entry: {
      main: './src/main/index.ts',
    },
    platform: 'node',
    dts: true,
    external: externalModules,
  },
])
