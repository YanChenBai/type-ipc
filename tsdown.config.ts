import { defineConfig } from 'tsdown'

const externalModules = [
  'electron',
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
      typebox: './src/typebox.ts',
    },
    platform: 'node',
    dts: true,
    external: externalModules,
  },
])
