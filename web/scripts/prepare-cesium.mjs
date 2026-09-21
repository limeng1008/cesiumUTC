import { cp, mkdir, mkdtemp, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// VueCesium loads the official prebuilt runtime. All imagery and workers are local.
// Stage a complete runtime so stale files (including sync conflict copies) cannot
// survive a package update and leak into Vite's public asset copy.
const cache = resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const staging = await mkdtemp(join(cache, 'cesium-stage-'))
for (const entry of ['Assets', 'ThirdParty', 'Widgets', 'Workers', 'Cesium.js']) {
  await cp(`node_modules/cesium/Build/Cesium/${entry}`, join(staging, entry), {
    recursive: true,
  })
}
await mkdir('public', { recursive: true })
const backup = join(await mkdtemp(join(cache, 'cesium-backup-')), 'cesium')
let hasPreviousRuntime = false
try {
  await rename('public/cesium', backup)
  hasPreviousRuntime = true
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
try {
  await rename(staging, 'public/cesium')
} catch (error) {
  if (hasPreviousRuntime) await rename(backup, 'public/cesium')
  throw error
}
if (hasPreviousRuntime) console.log(`Previous generated Cesium runtime preserved at ${backup}`)
console.log('Cesium runtime and Natural Earth imagery prepared at /cesium/.')
