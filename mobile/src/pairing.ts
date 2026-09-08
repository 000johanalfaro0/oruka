import { getSupabase } from '@/lib/supabase'

/**
 * Canjear el codigo que ensena el ordenador.
 *
 * El telefono todavia no tiene sesion, asi que no puede leer nada de la nube.
 * Lo unico que puede hacer sin haber entrado es llamar a esta funcion, que
 * comprueba el codigo, devuelve la sesion y borra la fila en el mismo paso.
 */

/** El prefijo que lleva el QR, para no confundirlo con cualquier otro codigo. */
const PREFIJO = /^oruka:/i

interface SesionGuardada {
  access_token: string
  refresh_token: string
}

/**
 * Deja el telefono dentro de la cuenta.
 *
 * Acepta tanto lo que sale del QR (`oruka:ABC...`) como el codigo escrito a
 * mano, en minusculas o mayusculas: quien lo teclea desde el sofa no tiene por
 * que acordarse del formato.
 */
export async function canjear(codigo: string): Promise<void> {
  const limpio = codigo.trim().replace(PREFIJO, '').toUpperCase()
  if (!limpio) throw new Error('No hay ningún código.')

  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('canjear_vinculacion', { codigo: limpio })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Ese código ya no vale. Genera otro en el ordenador.')

  const sesion = JSON.parse(String(data)) as SesionGuardada
  const { error: fallo } = await supabase.auth.setSession({
    access_token: sesion.access_token,
    refresh_token: sesion.refresh_token,
  })
  if (fallo) throw new Error(fallo.message)
}
