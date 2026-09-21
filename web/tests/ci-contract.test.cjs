const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')

test('automation invokes the frontend ci package script explicitly', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8')

  assert.match(workflow, /run: pnpm run ci/)
  assert.doesNotMatch(workflow, /run: pnpm ci(?:\s|$)/)
  assert.match(makefile, /cd web && pnpm run ci/)
})
