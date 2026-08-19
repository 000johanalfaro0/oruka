import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

/**
 * Modulos conocidos. La frontera se genera desde esta lista: cada modulo tiene
 * prohibido importar a los demas, tanto por alias como por ruta relativa.
 */
const MODULES = ['workspace', 'github', 'ideas', 'settings']

const CROSS_IMPORT_MESSAGE =
  'Los modulos no se importan entre si. Usa el bus (@/shell/bus) para pedirle algo a otro modulo.'

/** Una zona por modulo: prohibe importar cualquier otro modulo. */
const moduleBoundaries = MODULES.map((self) => {
  const others = MODULES.filter((m) => m !== self)
  return {
    files: [`src/modules/${self}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: others.flatMap((o) => [`@/modules/${o}`, `@/modules/${o}/*`, `../${o}`, `../${o}/*`]),
              message: CROSS_IMPORT_MESSAGE,
            },
          ],
        },
      ],
    },
  }
})

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  // El shell tampoco mete la mano dentro de un modulo: solo lo carga desde el
  // registro. Todo import de modulos vive en moduleRegistry.ts.
  {
    files: ['src/shell/**/*.{ts,tsx}'],
    ignores: ['src/shell/moduleRegistry.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*'],
              message:
                'El shell no conoce los modulos por dentro. Registralos en moduleRegistry.ts y usa el contrato.',
            },
          ],
        },
      ],
    },
  },
  ...moduleBoundaries,
)
