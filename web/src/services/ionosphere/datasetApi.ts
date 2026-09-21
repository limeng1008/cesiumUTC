import { getToken } from '../../utils/auth/token'
import type {
  Dataset,
  DatasetPage,
  ImportTask,
  BatchImportResult,
  CancelImportsResult,
} from '../../models/ionosphere/Dataset'

export const MAX_DATASET_BYTES = 1024 ** 3
const base = `${import.meta.env.VITE_BASE_API}/ionosphere/datasets`
type Envelope<T> = { code?: number; data: T; detail?: string; msg?: string }
function responseError(body: Envelope<unknown> | null, status: number): Error {
  const detail = typeof body?.detail === 'string' ? body.detail : body?.msg
  return new Error(detail || `数据管理请求失败 (${status})，请检查服务或重新登录`)
}
async function request<T>(
  path: string,
  signal?: AbortSignal,
  body?: object,
  method = 'GET'
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { token: getToken() || '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  const json: Envelope<T> | null = await response.json().catch(() => null)
  if (!response.ok || json?.code !== 200) throw responseError(json, response.status)
  return json.data
}
export function fetchDatasets(page = 1, pageSize = 20, signal?: AbortSignal): Promise<DatasetPage> {
  return request(
    `?${new URLSearchParams({ page: String(page), pageSize: String(pageSize) })}`,
    signal
  )
}
export function fetchDataset(id: string, signal?: AbortSignal): Promise<Dataset> {
  return request(`/${encodeURIComponent(id)}`, signal)
}
export function inspectDataset(id: string, signal?: AbortSignal): Promise<Dataset> {
  return request(`/${encodeURIComponent(id)}/inspect`, signal, undefined, 'POST')
}
export function importDataset(
  id: string,
  timeIndex: number,
  signal?: AbortSignal,
  parameter?: string
): Promise<ImportTask> {
  return request(
    `/${encodeURIComponent(id)}/imports`,
    signal,
    { timeIndex, ...(parameter ? { parameter } : {}) },
    'POST'
  )
}
export function importDatasetBatch(
  id: string,
  timeIndices: number[],
  signal?: AbortSignal,
  parameter?: string
): Promise<BatchImportResult> {
  return request(
    `/${encodeURIComponent(id)}/imports/batch`,
    signal,
    { timeIndices, ...(parameter ? { parameter } : {}) },
    'POST'
  )
}
export function cancelDatasetImports(
  id: string,
  timeIndices: number[],
  signal?: AbortSignal,
  parameter?: string
): Promise<CancelImportsResult> {
  return request(
    `/${encodeURIComponent(id)}/imports/cancel`,
    signal,
    { timeIndices, ...(parameter ? { parameter } : {}) },
    'POST'
  )
}
/** File is sent directly so large NetCDF uploads never become a multipart/JSON buffer. */
export async function uploadDataset(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Dataset> {
  if (!file.size) throw new Error('文件为空，请选择 SAMI3 NetCDF 文件')
  if (file.size > MAX_DATASET_BYTES) throw new Error('文件超过 1 GiB 上传限制')
  if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError')
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const finish = () => signal?.removeEventListener('abort', abort)
    xhr.open('POST', `${base}/upload?${new URLSearchParams({ filename: file.name })}`)
    xhr.setRequestHeader('token', getToken() || '')
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      finish()
      let json: Envelope<Dataset> | null = null
      try {
        json = JSON.parse(xhr.responseText)
      } catch {
        /* Error pages may be HTML. */
      }
      if (xhr.status < 200 || xhr.status >= 300 || json?.code !== 200)
        reject(responseError(json, xhr.status))
      else {
        onProgress?.(100)
        resolve(json.data)
      }
    }
    xhr.onerror = () => {
      finish()
      reject(new Error('上传连接中断，请检查网络后重试'))
    }
    xhr.onabort = () => {
      finish()
      reject(new DOMException('上传已取消', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    xhr.send(file)
  })
}
