import { getToken } from '../../utils/auth/token'
import { decodeVolume, validateMetadata } from '../../models/ionosphere/validation'
import type {
  IonosphereVolume,
  VolumeSource,
  VolumeSourceCatalog,
} from '../../models/ionosphere/IonosphereVolume'
async function requestError(response: Response, context: string): Promise<Error> {
  const body = await response.json().catch(() => null)
  const detail =
    typeof body?.detail === 'string' ? body.detail : typeof body?.msg === 'string' ? body.msg : ''
  return new Error(
    `${context} (${response.status})${detail ? `：${detail}` : '，请检查服务或重新登录'}`
  )
}
export async function fetchSources(signal: AbortSignal): Promise<VolumeSourceCatalog> {
  const response = await fetch(`${import.meta.env.VITE_BASE_API}/ionosphere/sources`, {
    headers: { token: getToken() || '' },
    signal,
  })
  if (!response.ok) throw await requestError(response, '数据源目录请求失败')
  const json = await response.json()
  if (json.code !== 200) throw new Error(json.msg || '数据源目录 API 返回异常')
  const catalog = json.data as VolumeSourceCatalog
  if (
    !catalog ||
    !['mock', 'sami3'].includes(catalog.defaultSource) ||
    !Array.isArray(catalog.sources) ||
    !catalog.sources.length ||
    catalog.sources.some(
      (source) =>
        !source ||
        !['mock', 'sami3'].includes(source.id) ||
        typeof source.name !== 'string' ||
        !source.name.trim() ||
        typeof source.available !== 'boolean'
    ) ||
    new Set(catalog.sources.map((source) => source.id)).size !== catalog.sources.length ||
    !catalog.sources.some((source) => source.id === catalog.defaultSource && source.available)
  )
    throw new Error('数据源目录格式异常')
  return catalog
}
/** Dedicated binary transport: do not run octet-stream through the JSON response interceptor. */
export async function fetchVolume(
  resolution: 'standard' | 'fine',
  signal: AbortSignal,
  source: VolumeSource = 'mock',
  importId?: string
): Promise<IonosphereVolume> {
  const base = `${import.meta.env.VITE_BASE_API}/ionosphere/volume`
  const headers: Record<string, string> = { token: getToken() || '' }
  const options = { headers, signal }
  const query = new URLSearchParams({ resolution, source })
  if (importId) {
    if (source !== 'sami3') throw new Error('导入数据集仅支持 SAMI3 数据源')
    query.set('importId', importId)
  }
  const metaResponse = await fetch(`${base}/metadata?${query}`, options)
  if (!metaResponse.ok) throw await requestError(metaResponse, 'Metadata 请求失败')
  const json = await metaResponse.json()
  if (json.code !== 200) throw new Error(json.msg || 'Metadata API 返回异常')
  const metadata = validateMetadata(json.data)
  if (metadata.source !== (source === 'sami3' ? 'sami3-model' : 'deterministic-mock'))
    throw new Error('请求与返回的数据源不一致，请重新加载')
  query.set('volumeId', metadata.id)
  const response = await fetch(`${base}?${query}`, options)
  if (!response.ok) throw await requestError(response, '体数据请求失败')
  if (!response.headers.get('content-type')?.includes('application/octet-stream'))
    throw new Error('体数据接口未返回 Float32 二进制')
  if (response.headers.get('x-volume-id') !== metadata.id)
    throw new Error('Metadata 与体数据版本不一致，请重试')
  return decodeVolume(metadata, await response.arrayBuffer())
}
