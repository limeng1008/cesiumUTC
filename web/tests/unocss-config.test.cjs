const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { loadConfigFromFile } = require('vite')

test('UnoCSS exclusions use the supported content pipeline config', async () => {
  const root = path.resolve(__dirname, '..')
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'test' },
    path.join(root, 'unocss.config.js'),
    root,
  )

  assert.ok(loaded)
  assert.equal(Object.hasOwn(loaded.config, 'exclude'), false)
  assert.deepEqual(loaded.config.content?.pipeline?.exclude, [
    'node_modules',
    '.git',
    '.github',
    '.husky',
    '.vscode',
    'build',
    'dist',
    'mock',
    'public',
    './stats.html',
  ])
})
