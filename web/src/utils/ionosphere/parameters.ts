/** Controlled scalar fields. A listed capability never implies a file contains it. */
export const scalarParameters = [
  { parameter: 'Ne', name: '电子密度', unit: 'm^-3' },
  { parameter: 'Te', name: '电子温度', unit: 'K' },
  { parameter: 'Ti', name: '离子温度', unit: 'K' },
  ...['O+', 'H+', 'He+', 'N+', 'NO+', 'O2+', 'N2+'].map((species) => ({
    parameter: `Ni_${species}`,
    name: `${species} 离子密度`,
    unit: 'm^-3',
  })),
] as const
export type ScalarParameter =
  | 'Ne'
  | 'Te'
  | 'Ti'
  | `Ni_${'O+' | 'H+' | 'He+' | 'N+' | 'NO+' | 'O2+' | 'N2+'}`
export const isTemperature = (parameter?: string) => parameter === 'Te' || parameter === 'Ti'
export const displayUnit = (unit?: string) => (unit === 'm^-3' ? 'm⁻³' : unit || '—')
export const parameterName = (parameter?: string) =>
  scalarParameters.find((p) => p.parameter === parameter)?.name || parameter || '参数'
export const taskParameter = (task?: { parameter?: string }) => task?.parameter || 'Ne'
