const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { createSSRApp } = require('vue')
const { renderToString } = require('vue/server-renderer')
const { parse, compileTemplate } = require('vue/compiler-sfc')

test('parameter directory renders each source layout and tolerates legacy entries', async () => {
  const filename = path.resolve(__dirname, '../src/views/data-management/index.vue')
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  const section = descriptor.template.content.match(/<section[^>]*aria-label="物理参数目录"[\s\S]*?<\/section>/)[0]
  const compiled = compileTemplate({ source: section, filename, id: 'parameter-layout' })
  assert.deepEqual(compiled.errors, [])
  const m = new Module(filename, module)
  m.paths = Module._nodeModulePaths(path.dirname(filename))
  m._compile(ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename)
  const entry = { parameter: 'Te', parameterName: '电子温度', sourceVariable: 'te', sourceUnit: 'K', unit: 'K', available: true }
  const render = parameters => renderToString(createSSRApp({
    render: m.exports.render,
    setup: () => ({ store: { parameter: 'Te', busy: false, selected: { status: 'preview', preview: { parameters } } } }),
  }))
  const current = await render([
    { ...entry, dimensions: ['time', 'alt', 'lat', 'lon'], shape: [2, 8, 9, 10] },
    { ...entry, parameter: 'Ti', parameterName: '离子温度', sourceVariable: 'ti', available: false,
      reason: '不支持额外物种轴', dimensions: ['time', 'species', 'alt', 'lat', 'lon'], shape: [2, 7, 8, 9, 10] },
  ])
  assert.match(current, /维度：time × alt × lat × lon/)
  assert.match(current, /形状：2 × 8 × 9 × 10/)
  assert.match(current, /<p>离子温度[^]*?维度：time × species × alt × lat × lon[^]*?形状：2 × 7 × 8 × 9 × 10[^]*?不支持额外物种轴<\/span><\/p>/)
  const legacy = await render([entry])
  assert.doesNotMatch(legacy, /维度：|形状：/)
  assert.match(legacy, /电子温度 · te · K → K/)
  const oldPreview = await render(undefined)
  assert.match(oldPreview, /旧版解析信息仅记录 Ne/)
  assert.doesNotMatch(oldPreview, /维度：|形状：/)
  const empty = await render([{ ...entry, dimensions: [], shape: [] }])
  assert.doesNotMatch(empty, /维度：|形状：/)
})
