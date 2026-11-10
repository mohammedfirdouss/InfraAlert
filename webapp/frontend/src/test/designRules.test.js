/** Design-system rules (DESIGN.md) that live in CSS and config, where component tests can't see them. */
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import tailwind from '../../tailwind.config.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const { colors } = tailwind.theme.extend

test('focus on dark surfaces is a signal-yellow outline', () => {
  const css = read('../index.css').replace(/\s+/g, ' ')
  expect(css).toContain(`.on-dark:focus-visible, .on-dark :focus-visible { outline-color: ${colors.signal[400]}; }`)
})

test('the browser chrome is ink, and the unused survey palette is gone', () => {
  expect(read('../../index.html')).toContain(`<meta name="theme-color" content="${colors.ink}" />`)
  expect(colors.survey).toBeUndefined()
})
