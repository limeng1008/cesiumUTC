const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const view = fs.readFileSync(path.join(root, 'src/views/ionosphere/volume/index.vue'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src/views/ionosphere/volume/volume.scss'), 'utf8')

test('volume scene omits the redundant lower-left caption', () => {
  assert.doesNotMatch(view, /class="volume-caption"/)
  assert.doesNotMatch(view, /visibilityCaption|regionCaption/)
})

test('desktop volume viewport may shrink while mobile keeps a usable scene height', () => {
  assert.match(styles, /\.volume-viewport\s*\{[^}]*min-height:\s*0;/s)
  assert.doesNotMatch(styles, /\.volume-caption\s*\{/)
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.volume-viewport\s*\{[^}]*min-height:\s*360px;/
  )
})
