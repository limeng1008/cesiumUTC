import { getToken } from '../../utils/auth/token'
import type { OverviewFrame, WeatherInfo } from '../../models/ionosphere/Overview'
const base = `${import.meta.env.VITE_BASE_API}/ionosphere`
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(base + path, { headers: { token: getToken() || '' }, signal })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.code !== 200)
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : body?.msg || `首页数据请求失败 (${response.status})`
    )
  return body.data
}
export function fetchOverviewFrame(
  datasetId: string,
  timeIndex: number,
  signal?: AbortSignal
): Promise<OverviewFrame> {
  return get(
    `/overview/frame?${new URLSearchParams({ datasetId, timeIndex: String(timeIndex) })}`,
    signal
  )
}
export function fetchSpaceWeather(timestamp: string, signal?: AbortSignal): Promise<WeatherInfo> {
  return get(`/space-weather?${new URLSearchParams({ timestamp })}`, signal)
}
