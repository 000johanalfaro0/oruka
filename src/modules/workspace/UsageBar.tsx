import { useWorkspaceStore } from './workspaceStore'
import './usage-bar.css'

/**
 * Lo que llevan gastado los CLIs que tienes abiertos, en la fila de abajo.
 *
 * Tres reglas, y las tres vienen de como funciona la cuota de verdad:
 *
 * 1. **Una barra por CLI, no por agente.** La cuota es de la cuenta, no de la
 *    ventana: dos agy abiertos comparten limite, asi que comparten barra.
 * 2. **Solo lo que este abierto.** Un CLI instalado pero sin ningun agente en
 *    marcha no ocupa sitio en el pie.
 * 3. **Cada uno con su medida y su etiqueta.** claude cuenta cuanto llevas de
 *    tu limite semanal y codex cuanta memoria le queda a la conversacion. No
 *    son lo mismo y no se suman: juntarlas en una sola cifra seria mentir.
 *
 * La fila NO se ensancha: todo cabe en la altura que ya tiene.
 */
export function UsageBar() {
  const open = useWorkspaceStore((s) => s.open)
  const clis = useWorkspaceStore((s) => s.clis)
  const usage = useWorkspaceStore((s) => s.usage)

  // Los CLIs con algun agente vivo, cada uno una sola vez.
  const abiertos = [...new Set(open.flatMap((p) => p.agents.map((a) => a.cliId)))]

  const barras = abiertos
    .map((id) => ({ cli: clis.find((c) => c.id === id), valor: usage[id] }))
    // Sin dato no hay barra. Una barra a cero se lee como «no gastas nada»,
    // que es distinto de «este agente no lo dice».
    .filter((b) => b.cli?.usage && typeof b.valor === 'number')

  if (barras.length === 0) return null

  return (
    <>
      {barras.map(({ cli, valor }) => {
        const spec = cli!.usage!
        const esPorcentaje = spec.unit === 'percent'
        // Con «left» la cifra baja al gastar: lo lleno es lo consumido.
        const consumido = esPorcentaje
          ? spec.direction === 'left'
            ? 100 - valor!
            : valor!
          : 0
        const apurado = esPorcentaje && consumido >= 85

        return (
          <span
            key={cli!.id}
            className={`usage${apurado ? ' is-apurado' : ''}`}
            data-tip={`${cli!.name}: ${valor}${esPorcentaje ? '%' : ''} ${spec.label}`}
          >
            <span className="usage__name">{cli!.name}</span>
            {esPorcentaje && (
              <span className="usage__bar" aria-hidden="true">
                <span className="usage__fill" style={{ width: `${clamp(consumido)}%` }} />
              </span>
            )}
            <span className="usage__num">
              {valor}
              {esPorcentaje ? '%' : ''}
            </span>
          </span>
        )
      })}
    </>
  )
}

/** Un CLI puede dar 103% o -2% en un mal repintado; la barra no se sale. */
function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}
