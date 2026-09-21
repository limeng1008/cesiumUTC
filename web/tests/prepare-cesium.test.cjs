const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, readFile, readdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

test('preparing Cesium replaces stale generated assets and preserves the old runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cesium-prepare-test-'))
  const source = join(root, 'node_modules/cesium/Build/Cesium')
  for (const entry of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
    await mkdir(join(source, entry), { recursive: true })
    await writeFile(join(source, entry, 'current.txt'), entry)
  }
  await writeFile(join(source, 'Cesium.js'), 'new runtime')
  await mkdir(join(root, 'public/cesium'), { recursive: true })
  await writeFile(join(root, 'public/cesium/Cesium 2.js'), 'old duplicate')
  await writeFile(join(root, 'public/keep.txt'), 'unrelated public asset')

  const result = spawnSync(
    process.execPath,
    [resolve(__dirname, '../scripts/prepare-cesium.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readdir(join(root, 'public/cesium'))).sort(), [
    'Assets',
    'Cesium.js',
    'ThirdParty',
    'Widgets',
    'Workers',
  ])
  assert.equal(await readFile(join(root, 'public/cesium/Cesium.js'), 'utf8'), 'new runtime')
  assert.equal(await readFile(join(root, 'public/keep.txt'), 'utf8'), 'unrelated public asset')
  const backupName = (await readdir(join(root, 'node_modules/.cache'))).find((name) =>
    name.startsWith('cesium-backup-')
  )
  assert.ok(backupName, 'the previous generated runtime remains recoverable')
  assert.equal(
    await readFile(join(root, 'node_modules/.cache', backupName, 'cesium/Cesium 2.js'), 'utf8'),
    'old duplicate'
  )
})
