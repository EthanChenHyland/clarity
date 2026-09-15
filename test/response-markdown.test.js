const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../renderer/response-markdown');
const { nextZoomFactor } = require('../src/ui-zoom');

test('renders common inline and display LaTeX including matrices', () => {
  for (const source of [String.raw`A $x^2$ B`, String.raw`A \(\frac{1}{2}\) B`, String.raw`\[\sum_{i=1}^n i\]`, '$$\nx^2\n$$', String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, '```math\nx^2\n```']) {
    assert.match(renderMarkdown(source), /class="katex"/);
    assert.doesNotMatch(renderMarkdown(source), /katex-error/);
  }
});
test('renders tables and headings while preserving code and currency', () => {
  assert.match(renderMarkdown('# Heading\n\n| A | B |\n|---|---|\n| 1 | 2 |'), /<table>/);
  assert.match(renderMarkdown('# Heading'), /<h1>Heading<\/h1>/);
  assert.doesNotMatch(renderMarkdown('`$x$`\n\n```js\nconst price = "$5";\n```'), /class="katex"/);
  assert.doesNotMatch(renderMarkdown('Costs $5 and $10.'), /class="katex"/);
});
test('model HTML and unsafe math commands cannot inject active content', () => {
  const out = renderMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n' + String.raw`$\href{javascript:alert(1)}{bad}$`);
  assert.doesNotMatch(out, /<script|href="javascript:/);
  assert.doesNotThrow(() => renderMarkdown(String.raw`$\frac{incomplete$`));
});
test('zoom shortcuts support plus, minus and reset with bounded scaling', () => {
  const input = key => ({ type: 'keyDown', meta: true, key });
  assert.equal(nextZoomFactor(input('+'), 1, true), 1.1);
  assert.equal(nextZoomFactor(input('='), 1, true), 1.1);
  assert.equal(nextZoomFactor(input('-'), 1, true), 0.9);
  assert.equal(nextZoomFactor(input('0'), 1.7, true), 1);
  assert.equal(nextZoomFactor(input('+'), 1.7, true), 1.7);
  assert.equal(nextZoomFactor(input('-'), 0.6, true), 0.6);
  assert.equal(nextZoomFactor({ type: 'keyDown', key: '-' }, 1, true), null);
});
