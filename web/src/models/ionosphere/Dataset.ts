import type { ScalarParameter } from '../../utils/ionosphere/parameters'
export interface DatasetParameter {
  parameter: string
  parameterName: string
  sourceVariable: string
  sourceUnit: string
  unit: 'm^-3' | 'K' | ''
  species?: string
  dimensions?: string[]
  shape?: number[]
  available: boolean
  reason?: string
}
export interface DatasetPreview {
  parameters?: DatasetParameter[]
  variable: string
  units: string
  outputUnits: string
  timeCount: number
  times: { index: number; timestamp: string }[]
  dimensions: { longitude: number; latitude: number; altitude: number }
  bounds: { longitude: [number, number]; latitude: [number, number]; altitude: [number, number] }
}
export interface ImportTask {
  parameter?: ScalarParameter
  id: string
  datasetId: string
  timeIndex: number
  timestamp: string
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled'
  progress: number
  error: string | null
  createdAt: string
}
export interface Dataset {
  id: string
  name: string
  originalName: string
  byteSize: number
  sha256: string
  status: 'inspecting' | 'preview' | 'failed'
  error: string | null
  preview: DatasetPreview | null
  createdAt: string
  ownerId: number
  imports: ImportTask[]
}
export interface DatasetPage {
  items: Dataset[]
  total: number
  page: number
  pageSize: number
}
export interface BatchImportResult {
  tasks: ImportTask[]
  queued: number
  skipped: number
}
export interface CancelImportsResult {
  tasks: ImportTask[]
  cancelled: number
}
