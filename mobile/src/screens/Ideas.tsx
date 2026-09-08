import { useEffect, useRef, useState } from 'react'
import { createIdea, listIdeas, listProjects } from '@/modules/ideas/repository'
import { fromImage } from '@/modules/ideas/ai'
import type { Idea, Project } from '@/modules/ideas/types'

/** El archivo tal cual, sin el "data:image/...;base64," de delante. */
function soloBase64(dataUrl: string): string {
  const coma = dataUrl.indexOf(',')
  return coma === -1 ? dataUrl : dataUrl.slice(coma + 1)
}

function leerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader()
    lector.onload = () => resolve(String(lector.result))
    lector.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    lector.readAsDataURL(file)
  })
}

/**
 * Las ideas, en el telefono.
 *
 * No se copia ni una consulta: se usa el mismo `repository.ts` del escritorio,
 * que es la unica puerta a esos datos. Si manana cambia la nube, cambia alli y
 * esto se entera solo.
 */
export function Ideas() {
  const [proyectos, setProyectos] = useState<Project[] | null>(null)
  const [abierto, setAbierto] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    listProjects()
      .then((lista) => {
        if (vivo) setProyectos(lista)
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      vivo = false
    }
  }, [])

  if (error) return <p className="error">{error}</p>
  if (abierto) return <Detalle proyecto={abierto} onVolver={() => setAbierto(null)} />
  if (!proyectos) return <p className="empty">Cargando tus proyectos…</p>
  if (proyectos.length === 0) return <p className="empty">Todavía no tienes proyectos.</p>

  return (
    <div className="idea-grid">
      {proyectos.map((p) => (
        <button type="button" className="idea-card" key={p.id} onClick={() => setAbierto(p)}>
          <span className="idea-card__title">{p.title}</span>
          {p.description && <span className="idea-card__desc">{p.description}</span>}
        </button>
      ))}
    </div>
  )
}

/** Las ideas de un proyecto, y el campo para añadir una. */
function Detalle({ proyecto, onVolver }: { proyecto: Project; onVolver: () => void }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [transcribiendo, setTranscribiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Si lo que hay escrito vino de una foto, para que se guarde con su tipo. */
  const [esTranscripcion, setEsTranscripcion] = useState(false)
  const fotoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let vivo = true
    listIdeas(proyecto.id)
      .then((lista) => {
        if (vivo) setIdeas(lista)
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      vivo = false
    }
  }, [proyecto.id])

  const guardar = async () => {
    const contenido = texto.trim()
    if (!contenido) return
    setGuardando(true)
    setError(null)
    try {
      // Puede devolver varias: la base corta las ideas muy largas en trozos.
      const nuevas = await createIdea(
        proyecto.id,
        contenido,
        esTranscripcion ? { type: 'image_transcription', source_label: 'foto' } : undefined,
      )
      setIdeas((previas) => [...(previas ?? []), ...nuevas])
      setTexto('')
      setEsTranscripcion(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  /**
   * Foto de un cuaderno (o de lo que sea) a texto, con IA.
   *
   * No se guarda sola: se deja escrita en el mismo cuadro donde se apunta
   * una idea a mano, para que la persona la revise -una IA leyendo letra
   * apretada se equivoca- antes de darle a "Añadir".
   */
  const transcribirFoto = async (file: File) => {
    setTranscribiendo(true)
    setError(null)
    try {
      const dataUrl = await leerComoDataUrl(file)
      const texto = await fromImage('transcribe_image', file.type, soloBase64(dataUrl))
      setTexto(texto)
      setEsTranscripcion(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTranscribiendo(false)
    }
  }

  return (
    <div className="chat">
      <header className="topbar">
        <button type="button" className="topbar__back" onClick={onVolver} aria-label="Volver">
          ‹
        </button>
        <span className="topbar__title">{proyecto.title}</span>
      </header>

      <div className="body">
        {error && <p className="error">{error}</p>}
        {!ideas && <p className="empty">Cargando ideas…</p>}
        {ideas && ideas.length === 0 && <p className="empty">Este proyecto está vacío.</p>}
        {ideas && ideas.length > 0 && (
          <section className="card">
            {ideas.map((idea) => (
              <p className="idea" key={idea.id}>
                {idea.content}
                <span className="idea__date">
                  {new Date(idea.created_at).toLocaleDateString('es-ES')}
                </span>
              </p>
            ))}
          </section>
        )}
      </div>

      {transcribiendo && <p className="empty">Leyendo la foto…</p>}

      <div className="composer">
        <input
          ref={fotoRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void transcribirFoto(file)
          }}
        />
        <button
          type="button"
          className="composer__foto"
          disabled={transcribiendo}
          title="Transcribir una foto con IA"
          onClick={() => fotoRef.current?.click()}
        >
          📷
        </button>
        <textarea
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            setEsTranscripcion(false)
          }}
          placeholder="Apunta una idea, o transcribe una foto…"
          rows={1}
        />
        <button
          type="button"
          disabled={guardando || texto.trim().length === 0}
          onClick={() => void guardar()}
        >
          Añadir
        </button>
      </div>
    </div>
  )
}
