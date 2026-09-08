import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

/** La misma version que llevan el instalador de escritorio y el APK. */
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string }

/**
 * La web instalable del telefono.
 *
 * Vive en el mismo repositorio y comparte dependencias con el escritorio, pero
 * se construye aparte: son dos programas distintos con la misma nube en medio.
 *
 * La unica pieza rara es el cambio de `@/lib/supabase`. El escritorio guarda su
 * sesion en un archivo a traves de Tauri, cosa que en un navegador no existe;
 * cambiandolo aqui por el cliente del movil, el resto del codigo compartido
 * —el cartero y todo el modulo de Ideas— funciona sin tocar una linea.
 *
 * El orden importa: la regla larga va antes que la corta, o `@` se la comeria.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Las credenciales viven en el `.env.local` de la raiz, uno para los dos.
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  // Rutas relativas: la pagina cuelga de un subdirectorio en GitHub Pages.
  base: './',
  resolve: {
    alias: [
      {
        find: '@/lib/supabase',
        replacement: fileURLToPath(new URL('./src/supabase.ts', import.meta.url)),
      },
      { find: '@', replacement: fileURLToPath(new URL('../src', import.meta.url)) },
    ],
  },
  // `host: true` para poder abrirlo desde el telefono contra este equipo.
  server: { port: 1421, strictPort: true, host: true },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: 'es2020',
    outDir: fileURLToPath(new URL('../dist-mobile', import.meta.url)),
    emptyOutDir: true,
  },
})
