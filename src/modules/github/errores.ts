/**
 * Traduce lo que contesta `gh` a algo que se pueda leer.
 *
 * gh responde en ingles y con las tripas dentro: «failed to create review:
 * GraphQL: Review Can not request changes on your own pull request
 * (addPullRequestReview)». La parte que le importa a alguien son cinco palabras
 * del medio; el resto es el nombre de la mutacion y el envoltorio del
 * transporte.
 *
 * Solo se traduce lo que se reconoce con seguridad. Lo demas se deja tal cual
 * —inventarse una explicacion es peor que ensenar la de GitHub— pero sin el
 * envoltorio, que no le dice nada a nadie.
 */

const CONOCIDOS: Array<[RegExp, string]> = [
  [
    /can ?not approve your own pull request/i,
    'GitHub no deja aprobar tu propia propuesta. Hace falta otra cuenta.',
  ],
  [
    /can ?not request changes on your own pull request/i,
    'GitHub no deja pedir cambios en tu propia propuesta. Hace falta otra cuenta.',
  ],
  [
    /not mergeable|merge conflict/i,
    'No se puede fusionar: hay conflictos con la rama de destino. Hay que resolverlos antes.',
  ],
  [
    /review cannot be requested from pull request author/i,
    'No puedes pedirte una revisión a ti mismo.',
  ],
  [
    /gh no esta instalado|gh: command not found/i,
    'No se encuentra gh. Instálalo desde Ajustes y vuelve a intentarlo.',
  ],
]

export function explicar(error: unknown): string {
  const crudo = String(error).trim()
  for (const [patron, texto] of CONOCIDOS) {
    if (patron.test(crudo)) return texto
  }
  // Se quita «failed to create review: GraphQL:» por delante y el nombre de la
  // mutacion entre parentesis por detras. Si al quitarlo no queda nada, se
  // devuelve el original: un error vacio es peor que uno feo.
  const limpio = crudo
    .replace(/^.*?GraphQL:\s*/i, '')
    .replace(/\s*\([A-Za-z]+\)\s*$/, '')
    .trim()
  return limpio || crudo
}
