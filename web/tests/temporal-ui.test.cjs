const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs')
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')
test('temporal page and charts compile with controls and missing-state explanations', () => {
  for (const file of [
    'src/views/time-variation/index.vue',
    'src/components/ionosphere/TemporalCharts.vue',
  ]) {
    assert.ok(fs.existsSync(file), 'temporal UI must exist')
    const source = fs.readFileSync(file, 'utf8'),
      { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: 'temporal-test' })
    assert.deepEqual(
      compileTemplate({
        source: descriptor.template.content,
        filename: file,
        id: 'temporal-test',
        compilerOptions: { bindingMetadata: script.bindings },
      }).errors,
      []
    )
  }
  const page = fs.readFileSync('src/views/time-variation/index.vue', 'utf8')
  for (const text of ['datetime-local', 'AnalysisMap', '取消', 'UTC', '未入库', '/analysis'])
    assert.ok(page.includes(text), text)
  assert.match(page, /v-if="!store.rows.length" class="analysis-panel analysis-empty"/)
})
test('temporal navigation is explicit and linked to the selected dataset', () => {
  const routes = fs.readFileSync('src/router/routes/index.js', 'utf8')
  assert.match(routes, /module.key === 'temporal'/)
  assert.match(routes, /@\/views\/time-variation\/index.vue/)
  assert.match(
    fs.readFileSync('src/config/navigation.js', 'utf8'),
    /key: 'temporal'[\s\S]*?available: true/
  )
  assert.match(fs.readFileSync('src/views/analysis/index.vue', 'utf8'), /\/time-variation/)
})

test('height detail table reads raw profiles including zero and missing, not color-filtered cells', () => {
  const chart=fs.readFileSync('src/components/ionosphere/TemporalCharts.vue','utf8')
  assert.match(chart,/selectedProfile/)
  assert.match(chart,/\.profile\.map/)
  assert.match(chart,/detailsOpen/)
})
