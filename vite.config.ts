import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Tauri sirve el front en 1420 y espera que no se limpie la consola.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Vite no debe vigilar el target de Rust: son binarios en uso y da EBUSY.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'esnext',
    // Cada modulo sale en su propio chunk: el shell no arrastra a los modulos.
    rollupOptions: {
      output: {
        manualChunks(id) {
          const m = id.match(/src\/modules\/([^/]+)\//)
          return m ? `module-${m[1]}` : undefined
        },
      },
    },
  },
})
