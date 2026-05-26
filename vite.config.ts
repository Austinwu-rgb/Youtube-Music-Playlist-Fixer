import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './extension/manifest.json'

export default defineConfig({
  root: 'extension',
  plugins: [crx({ manifest })],
  build: {
    outDir: '../build',
    emptyOutDir: true,
    minify: false,
  },
})
