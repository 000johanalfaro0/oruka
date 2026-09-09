import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

/**
 * El cartero entre el PC y el movil.
 *
 * Aqui no hay ni una linea que sepa lo que es un agente, un PTY o una pestana:
 * esto solo lleva y trae sobres. Quien los abre y decide que hacer con ellos es
 * `modules/workspace/remoteBridge.ts` en el PC, y las pantallas en el movil.
 * Por eso vive en `lib/` y no dentro de un modulo: los dos lados lo importan, y
 * un modulo no puede importar a otro.
 *
 * El cliente de Supabase se pasa por parametro en vez de importarlo. El de
 * escritorio guarda la sesion en un archivo por Tauri y el del movil en el
 * navegador: son dos clientes distintos y este archivo no puede elegir por
 * ellos.
 */

// ---------------------------------------------------------------------------
// El sobre. Esta es la unica forma que el PC y el movil acuerdan.
// ---------------------------------------------------------------------------

/** Un agente visto desde fuera. Lo justo para pintarlo en una lista. */
export interface RemoteAgent {
  sessionId: string
  cliId: string
  cliName: string
  /** trabajando, esperando o terminado. Los mismos tres del escritorio. */
  actividad: string
}

/** Un proyecto abierto en el PC, con sus agentes. */
export interface RemoteProject {
  path: string
  name: string
  agents: RemoteAgent[]
}

/**
 * La foto de lo que hay abierto en el PC.
 *
 * Lleva version dentro porque el movil se actualiza solo y el escritorio no:
 * durante un tiempo van a convivir dos versiones y el movil tiene que poder
 * decir «no entiendo esta foto» en vez de pintar cosas a medias.
 */
export interface RemoteSnapshot {
  version: 1
  projects: RemoteProject[]
  activePath: string | null
  /**
   * Carpetas que Oruka conoce pero no tiene abiertas ahora mismo.
   *
   * El movil las necesita para poder pedir "abre esta". Abrir o cerrar una
   * pestana no ejecuta nada por si solo, es solo navegacion.
   */
  closedProjects: { path: string; name: string }[]
  /**
   * Los CLIs que de verdad estan instalados en este equipo, con sus modos.
   *
   * El movil puede pedir lanzar uno de estos en un proyecto ya abierto, y
   * elegir el modo -pero nunca "yolo": esa palabra no aparece en `modes` de
   * aqui, se filtra antes de publicar la foto. Pedir "yolo" desde el telefono
   * no es un camino que exista, aunque se inventara el mensaje a mano.
   */
  clis: { id: string; name: string; modes: string[] }[]
}

/** Un PC que se ofrece como mando a distancia. */
export interface RemoteHost {
  id: string
  name: string
  state: RemoteSnapshot | null
  online: boolean
  last_seen: string
}

/** Un trozo de salida de una sesion, ya sin escapes ANSI. */
export interface OutputChunk {
  session_id: string
  /** Bytes que la sesion lleva emitidos contando ya este trozo. */
  seq: number
  text: string
}

/**
 * Lo que el movil quiere meter en una sesion, o pedirle al workspace.
 *
 * `text` es una frase, que se escribe y se envia. `key` es una tecla suelta
 * (escape, interrumpir). `open_project`/`close_project`/`launch_agent` no
 * tocan ninguna sesion -van con `session_id: 'workspace'`-, son ordenes para
 * el workspace en si. `open_project`/`close_project` llevan la ruta en
 * `body`; `launch_agent` lleva `{"path": "...", "cli": "...", "mode": "..."}`
 * como JSON -`mode` es opcional y, si no esta en `RemoteSnapshot.clis` para
 * ese CLI (que nunca incluye "yolo"), el PC usa el primero de la lista.
 */
export interface InputMessage {
  id: string
  session_id: string
  kind: 'text' | 'key' | 'open_project' | 'close_project' | 'launch_agent'
  body: string
  created_at: string
  applied_at: string | null
}

/** Como cancelar una suscripcion. */
export type Unsubscribe = () => void

// ---------------------------------------------------------------------------

/**
 * Abre el cartero sobre un cliente de Supabase ya autenticado.
 *
 * Todas las escrituras llevan el `user_id` de quien las hace porque la base lo
 * exige: la regla de acceso compara ese campo con quien pregunta, y una fila
 * sin el se rechaza en el momento de insertarla.
 */
export function createRelay(supabase: SupabaseClient) {
  async function requireUser(): Promise<string> {
    const { data } = await supabase.auth.getUser()
    const id = data.user?.id
    if (!id) throw new Error('No hay sesión activa.')
    return id
  }

  return {
    // -----------------------------------------------------------------------
    // Lado PC
    // -----------------------------------------------------------------------

    /**
     * Registra este equipo, o actualiza su nombre si ya estaba.
     *
     * El id se guarda fuera de aqui, en el almacen del escritorio: si cada
     * arranque creara un equipo nuevo, la lista del movil se llenaria de PCs
     * fantasma con el mismo nombre.
     *
     * Si el id recordado se perdio (perfil nuevo, recarga en caliente durante
     * desarrollo, o el usuario lo borro desde el movil), no se inserta a
     * ciegas: primero se busca una fila de este mismo usuario con este mismo
     * nombre y se reusa. Solo si de verdad no hay ninguna se crea una nueva.
     * Sin este paso, dos arranques que pierden el id a la vez -la carrera que
     * paso durante el desarrollo de esto mismo- dejan equipos fantasma
     * duplicados que nadie apaga nunca.
     */
    async registerHost(name: string, existingId: string | null): Promise<string> {
      const user_id = await requireUser()

      if (existingId) {
        const { data, error } = await supabase
          .from('remote_hosts')
          .update({ name, last_seen: new Date().toISOString() })
          .eq('id', existingId)
          .select('id')
          .maybeSingle()
        if (error) throw new Error(error.message)
        // Si la fila ya no existe (el usuario la borro desde el movil), se cae
        // al resto en vez de fallar.
        if (data) return data.id as string
      }

      const existente = await supabase
        .from('remote_hosts')
        .select('id')
        .eq('user_id', user_id)
        .eq('name', name)
        .order('last_seen', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existente.error) throw new Error(existente.error.message)
      if (existente.data) {
        const { error } = await supabase
          .from('remote_hosts')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', existente.data.id)
        if (error) throw new Error(error.message)
        return existente.data.id as string
      }

      const { data, error } = await supabase
        .from('remote_hosts')
        .insert({ user_id, name, online: false })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return data.id as string
    },

    /**
     * Enciende o apaga el mando.
     *
     * Apagado es el estado normal. Encenderlo significa que alguien con tu
     * cuenta puede escribir en tus agentes desde el telefono.
     */
    async setOnline(hostId: string, online: boolean): Promise<void> {
      const { error } = await supabase
        .from('remote_hosts')
        .update({ online, last_seen: new Date().toISOString() })
        .eq('id', hostId)
      if (error) throw new Error(error.message)
    },

    /** Publica la foto de lo que hay abierto. */
    async publishState(hostId: string, state: RemoteSnapshot): Promise<void> {
      const { error } = await supabase
        .from('remote_hosts')
        .update({ state, last_seen: new Date().toISOString() })
        .eq('id', hostId)
      if (error) throw new Error(error.message)
    },

    /**
     * Publica trozos de salida.
     *
     * Van en lote a proposito: una sesion viva emite cientos de veces por
     * segundo y una peticion por trozo tumbaria la conexion y la factura. Quien
     * llama junta lo de un rato y lo manda de una vez.
     *
     * Reenviar un trozo ya publicado no duplica nada: la base tiene la pareja
     * (sesion, seq) marcada como unica, y aqui se ignora ese choque.
     */
    async publishOutput(hostId: string, chunks: OutputChunk[]): Promise<void> {
      if (chunks.length === 0) return
      const user_id = await requireUser()
      const { error } = await supabase
        .from('remote_output')
        .upsert(
          chunks.map((c) => ({ ...c, host_id: hostId, user_id })),
          { onConflict: 'host_id,session_id,seq', ignoreDuplicates: true },
        )
      if (error) throw new Error(error.message)
    },

    /**
     * Lo que el movil dejo escrito y este PC todavia no ha metido en el PTY.
     *
     * Se pide al encender el mando: mientras estaba apagado o sin red pueden
     * haberse acumulado mensajes, y perderlos en silencio seria peor que
     * entregarlos tarde.
     */
    async pendingInput(hostId: string): Promise<InputMessage[]> {
      const { data, error } = await supabase
        .from('remote_input')
        .select('id, session_id, kind, body, created_at, applied_at')
        .eq('host_id', hostId)
        .is('applied_at', null)
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as InputMessage[]
    },

    /** Escucha lo que el movil vaya dejando para este PC. */
    onInput(hostId: string, handler: (msg: InputMessage) => void): Unsubscribe {
      const channel: RealtimeChannel = supabase
        .channel(`relay-input-${hostId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'remote_input',
            filter: `host_id=eq.${hostId}`,
          },
          (payload) => handler(payload.new as InputMessage),
        )
        .subscribe()
      return () => void supabase.removeChannel(channel)
    },

    /** Marca mensajes como ya tecleados, para que el movil deje de esperarlos. */
    async markApplied(ids: string[]): Promise<void> {
      if (ids.length === 0) return
      const { error } = await supabase
        .from('remote_input')
        .update({ applied_at: new Date().toISOString() })
        .in('id', ids)
      if (error) throw new Error(error.message)
    },

    // -----------------------------------------------------------------------
    // Lado movil
    // -----------------------------------------------------------------------

    /** Los equipos de esta cuenta, el visto mas recientemente primero. */
    async listHosts(): Promise<RemoteHost[]> {
      const { data, error } = await supabase
        .from('remote_hosts')
        .select('id, name, state, online, last_seen')
        .order('last_seen', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as RemoteHost[]
    },

    /** Avisa cuando un equipo cambia de estado o de foto. */
    onHostChange(handler: (host: RemoteHost) => void): Unsubscribe {
      const channel: RealtimeChannel = supabase
        .channel('relay-hosts')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'remote_hosts' },
          (payload) => {
            const row = payload.new as Partial<RemoteHost>
            if (row && row.id) handler(row as RemoteHost)
          },
        )
        .subscribe()
      return () => void supabase.removeChannel(channel)
    },

    /**
     * La salida de una sesion a partir de un punto.
     *
     * `sinceSeq` es el ultimo trozo que ya se tiene. Pedir desde ahi es lo que
     * evita ver dos veces lo mismo al volver a la pantalla o al recuperar la
     * conexion; es el mismo contador que usa el escritorio para repintar.
     */
    async readOutput(hostId: string, sessionId: string, sinceSeq = 0): Promise<OutputChunk[]> {
      const { data, error } = await supabase
        .from('remote_output')
        .select('session_id, seq, text')
        .eq('host_id', hostId)
        .eq('session_id', sessionId)
        .gt('seq', sinceSeq)
        .order('seq', { ascending: true })
        .limit(500)
      if (error) throw new Error(error.message)
      return (data ?? []) as OutputChunk[]
    },

    /**
     * Escucha la salida de una sesion en directo.
     *
     * El filtro del servidor solo admite una condicion, asi que llega todo lo
     * de este equipo y la sesion se descarta aqui. `onReady` avisa cuando el
     * canal queda enganchado: es el momento de volver a pedir por `readOutput`
     * lo que se haya perdido mientras no habia conexion.
     */
    onOutput(
      hostId: string,
      sessionId: string,
      handler: (chunk: OutputChunk) => void,
      onReady?: () => void,
    ): Unsubscribe {
      const channel: RealtimeChannel = supabase
        .channel(`relay-output-${hostId}-${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'remote_output',
            filter: `host_id=eq.${hostId}`,
          },
          (payload) => {
            const chunk = payload.new as OutputChunk
            if (chunk.session_id === sessionId) handler(chunk)
          },
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onReady?.()
        })
      return () => void supabase.removeChannel(channel)
    },

    /** Deja un mensaje para que el PC lo teclee. Devuelve su id. */
    async sendInput(
      hostId: string,
      sessionId: string,
      body: string,
      kind: InputMessage['kind'] = 'text',
    ): Promise<string> {
      const user_id = await requireUser()
      const { data, error } = await supabase
        .from('remote_input')
        .insert({ user_id, host_id: hostId, session_id: sessionId, kind, body })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return data.id as string
    },

    /** Avisa cuando el PC confirma que ya tecleo un mensaje. */
    onInputApplied(hostId: string, handler: (msg: InputMessage) => void): Unsubscribe {
      const channel: RealtimeChannel = supabase
        .channel(`relay-applied-${hostId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'remote_input',
            filter: `host_id=eq.${hostId}`,
          },
          (payload) => handler(payload.new as InputMessage),
        )
        .subscribe()
      return () => void supabase.removeChannel(channel)
    },
  }
}

export type Relay = ReturnType<typeof createRelay>
