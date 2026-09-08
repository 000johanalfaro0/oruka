import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { bus } from '@/shell/bus'
import { writeClipboard } from '@/lib/clipboard'
import { crearVinculacion, retirarVinculacion, type Vinculacion } from './pairing'
import './mobile.css'

/**
 * Modulo Movil.
 *
 * Tres pasos en orden, y ninguno adivina nada: encender el mando, instalar la
 * app en el telefono, y vincularlo escaneando un codigo.
 *
 * Este modulo no sabe lo que es un agente ni una terminal. El interruptor viaja
 * por el bus hasta Workspace, que es quien conoce las sesiones: los modulos no
 * se importan entre si, y ese limite lo vigila el lint.
 */

/**
 * De donde se baja la app de Android.
 *
 * Apunta a `releases/latest`, que se mueve solo con cada version nueva: es la
 * misma direccion que ya usa el aviso de actualizacion del escritorio, asi que
 * no caduca a mano.
 */
const APK_URL = 'https://github.com/000johanalfaro0/oruka/releases/latest/download/oruka.apk'

/** «4:05». Lo que le queda de vida al codigo. */
function reloj(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const segundos = String(total % 60).padStart(2, '0')
  return `${Math.floor(total / 60)}:${segundos}`
}

interface EstadoMando {
  enabled: boolean
  hostId: string | null
  error: string | null
}

export default function MobileModule() {
  const [mando, setMando] = useState<EstadoMando>({
    enabled: false,
    hostId: null,
    error: null,
  })
  const [apkQr, setApkQr] = useState<string | null>(null)
  const [vinculo, setVinculo] = useState<Vinculacion | null>(null)
  const [vinculoQr, setVinculoQr] = useState<string | null>(null)
  const [restante, setRestante] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  /** El ultimo codigo emitido, para poder retirarlo al salir de la pantalla. */
  const vivoRef = useRef<string | null>(null)

  // Como esta el mando. Es estado retenido: al volver a esta pestana llega el
  // valor actual sin esperar a que nadie lo cambie.
  useEffect(() => bus.on('workspace.remoteState', setMando), [])

  // El QR de la descarga no cambia nunca: se dibuja una vez.
  useEffect(() => {
    QRCode.toDataURL(APK_URL, { margin: 1, width: 352 })
      .then(setApkQr)
      .catch(() => setApkQr(null))
  }, [])

  // La cuenta atras del codigo. Al llegar a cero el QR desaparece: ensenar uno
  // caducado solo consigue que alguien lo escanee y no entienda por que falla.
  useEffect(() => {
    if (!vinculo) return
    const marcar = () => {
      const queda = vinculo.expiresAt - Date.now()
      setRestante(queda)
      if (queda <= 0) {
        setVinculo(null)
        setVinculoQr(null)
        vivoRef.current = null
      }
    }
    marcar()
    const id = setInterval(marcar, 1000)
    return () => clearInterval(id)
  }, [vinculo])

  // Al cerrar la pestana se retira el codigo que quedara vivo.
  useEffect(
    () => () => {
      const pendiente = vivoRef.current
      if (pendiente) void retirarVinculacion(pendiente).catch(() => {})
    },
    [],
  )

  const generar = async () => {
    setOcupado(true)
    setError(null)
    try {
      const anterior = vivoRef.current
      if (anterior) await retirarVinculacion(anterior).catch(() => {})
      const nuevo = await crearVinculacion()
      vivoRef.current = nuevo.code
      // El prefijo evita que la camara del telefono confunda esto con otra
      // cosa: si lo que escanea no empieza por `oruka:`, no es para nosotros.
      setVinculoQr(await QRCode.toDataURL(`oruka:${nuevo.code}`, { margin: 1, width: 352 }))
      setVinculo(nuevo)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  const copiarEnlace = async () => {
    await writeClipboard(APK_URL)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1500)
  }

  return (
    <div className="mob">
      <h1 className="mob__title">Móvil</h1>
      <p className="mob__lead">
        Mira tus agentes desde el teléfono y escríbeles. Lo que escribas entra en la
        sesión real de este ordenador.
      </p>

      {/* 1. El interruptor */}
      <section className={`mob__card${mando.enabled ? ' mob__card--on' : ''}`}>
        <div className="mob__head">
          <span className="mob__name">
            <span className="mob__step">1</span>
            Conectar este ordenador
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={mando.enabled}
            className="mob__switch"
            onClick={() => bus.request('workspace.setRemote', { on: !mando.enabled })}
          >
            {mando.enabled ? 'Desconectar' : 'Conectar'}
          </button>
        </div>

        <div className="mob__estado">
          <span
            className={`mob__punto${mando.enabled ? ' mob__punto--on' : ''}`}
            aria-hidden="true"
          />
          <span>{mando.enabled ? 'Conectado. Tu móvil puede verlo.' : 'Desconectado.'}</span>
        </div>

        {mando.enabled && (
          <p className="mob__warn">
            Mientras esté conectado, cualquiera que entre con tu cuenta desde un teléfono
            puede escribir en tus agentes, y ellos ejecutan cosas en este ordenador. Lo que
            salga en sus terminales se guarda en tu propio Supabase y se borra a las 24
            horas.
          </p>
        )}

        {mando.error && <p className="mob__error">{mando.error}</p>}
      </section>

      {/* 2. La app */}
      <section className="mob__card">
        <span className="mob__name">
          <span className="mob__step">2</span>
          Instalar la app en el teléfono
        </span>
        <p className="mob__hint">
          Escanea este código con la cámara del móvil para bajar la app. Android te pedirá
          permiso para instalar algo que no viene de la tienda: es normal, la app la
          construyes tú.
        </p>

        <div className="mob__qr">
          {apkQr && <img src={apkQr} alt={`Código para descargar la app: ${APK_URL}`} />}
          <div className="mob__qr-lado">
            <span className="mob__cuenta">O abre esta dirección en el teléfono:</span>
            <span className="mob__enlace">{APK_URL}</span>
          </div>
        </div>

        <div className="mob__acciones">
          <button type="button" className="mob__boton" onClick={() => void copiarEnlace()}>
            {copiado ? 'Copiado' : 'Copiar enlace'}
          </button>
        </div>
      </section>

      {/* 3. Vincular */}
      <section className="mob__card">
        <span className="mob__name">
          <span className="mob__step">3</span>
          Vincular el teléfono
        </span>
        <p className="mob__hint">
          Abre la app y pulsa «Escanear». Este código dura cinco minutos y solo sirve una
          vez, así que no pasa nada si alguien lo ve de reojo: no lleva tu contraseña
          dentro.
        </p>

        {vinculo && vinculoQr ? (
          <>
            <div className="mob__qr">
              <img src={vinculoQr} alt="Código para vincular el teléfono" />
              <div className="mob__qr-lado">
                <span className="mob__cuenta">Si la cámara no lo lee, escribe esto:</span>
                <span className="mob__codigo">{vinculo.code}</span>
                <span className="mob__cuenta">Caduca en {reloj(restante)}</span>
              </div>
            </div>
            <div className="mob__acciones">
              <button
                type="button"
                className="mob__boton"
                disabled={ocupado}
                onClick={() => void generar()}
              >
                Generar otro
              </button>
            </div>
          </>
        ) : (
          <div className="mob__acciones">
            <button
              type="button"
              className="mob__boton mob__boton--principal"
              disabled={ocupado}
              onClick={() => void generar()}
            >
              {ocupado ? 'Generando…' : 'Generar código'}
            </button>
          </div>
        )}

        {error && <p className="mob__error">{error}</p>}
      </section>
    </div>
  )
}
