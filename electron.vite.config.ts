import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main'
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload'
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    // Bind IPv4 as well as IPv6; Node on Windows often listens only on [::1], so
    // http://localhost:5173 fails when the browser resolves localhost → 127.0.0.1.
    server: {
      host: true,
      port: 5173
    },
    build: {
      outDir: 'dist/renderer'
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
        '@config': resolve('config')
      }
    },
    plugins: [react()]
  }
})
