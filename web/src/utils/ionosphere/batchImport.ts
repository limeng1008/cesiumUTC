import type { ImportTask } from '../../models/ionosphere/Dataset'
type SourceTime = { index: number; timestamp: string }

export function selectBatchTimes(times: SourceTime[], start: string, end: string, stride: number) {
  const low = Date.parse(start + 'Z'),
    high = Date.parse(end + 'Z')
  if (![low, high].every(Number.isFinite) || low > high) throw new Error('UTC 时间范围无效')
  if (!Number.isInteger(stride) || stride < 1) throw new Error('间隔须为大于零的整数')
  return [...times]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .filter((t) => Date.parse(t.timestamp) >= low && Date.parse(t.timestamp) <= high)
    .filter((_, i) => i % stride === 0)
}

export function batchSummary(times: SourceTime[], tasks: ImportTask[]) {
  const counts = {
    total: times.length,
    ready: 0,
    queued: 0,
    processing: 0,
    failed: 0,
    cancelled: 0,
    unimported: 0,
    settled: 0,
    percent: 0,
  }
  const byIndex = new Map(tasks.map((t) => [t.timeIndex, t]))
  let progress = 0
  for (const time of times) {
    const task = byIndex.get(time.index)
    if (!task) {
      counts.unimported++
      continue
    }
    counts[task.status]++
    if (['ready', 'failed', 'cancelled'].includes(task.status)) {
      counts.settled++
      progress += 100
    } else if (task.status === 'processing')
      progress += Math.max(0, Math.min(100, task.progress || 0))
  }
  counts.percent = times.length ? Math.round(progress / times.length) : 0
  return counts
}
