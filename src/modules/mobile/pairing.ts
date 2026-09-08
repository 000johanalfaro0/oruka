import { getSupabase } from '@/lib/supabase'

/**
 * Vincular un telefono sin escribir la contrasena en el.
 *
 * El escritorio deja su sesion en la nube bajo un codigo de un solo uso, y el
 * QR ensena SOLO ese codigo. La sesion nunca esta en la foto: quien fotografie
 * la pantalla se lleva doce letras que caducan en cinco minutos y que ademas
 * mueren en cuanto el telefono las canjea.
 */

/** Lo que vive un codigo. Cinco minutos: lo que se tarda en coger el movil. */
export const VIDA_MS = 5 * 60 * 1000

/**
 * Sin I, L, O, 0 ni 1.
 *
 * El codigo se lee tambien con los ojos cuando la camara no coopera, y esas
 * cinco se confunden entre si en cualquier tipografia.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Doce caracteres al azar de verdad, no del generador de juguete. */
function codigoNuevo(largo = 12): string {
  const bytes = new Uint8Array(largo)
  crypto.getRandomValues(bytes)
  let salida = ''
  for (const b of bytes) salida += ALFABETO[b % ALFABETO.length] ?? 'X'
  return salida
}

export interface Vinculacion {
  code: string
  /** Cuando deja de valer, en milisegundos desde 1970. */
  expiresAt: number
}

/**
 * Crea un codigo y deja la sesion esperando detras de el.
 *
 * Lo que se guarda son los dos tokens de la sesion, nada mas: ni el correo ni
 * la contrasena, que Oruka tampoco tiene.
 */
export async function crearVinculacion(): Promise<Vinculacion> {
  const supabase = await getSupabase()
  const { data } = await supabase.auth.getSession()
  const sesion = data.session
  if (!sesion) throw new Error('No hay sesión activa en este equipo.')

  const code = codigoNuevo()
  const expiresAt = Date.now() + VIDA_MS

  const { error } = await supabase.from('remote_pairings').insert({
    code,
    user_id: sesion.user.id,
    payload: JSON.stringify({
      access_token: sesion.access_token,
      refresh_token: sesion.refresh_token,
    }),
    expires_at: new Date(expiresAt).toISOString(),
  })
  if (error) throw new Error(error.message)

  return { code, expiresAt }
}

/**
 * Retira un codigo antes de tiempo.
 *
 * Se llama al salir de la pantalla y al pedir uno nuevo. Caducaria solo, pero
 * un codigo vivo que ya nadie mira no tiene por que seguir existiendo.
 */
export async function retirarVinculacion(code: string): Promise<void> {
  const supabase = await getSupabase()
  await supabase.from('remote_pairings').delete().eq('code', code)
}
