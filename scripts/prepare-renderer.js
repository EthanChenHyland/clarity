const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');
async function prepareRenderer() {
  const root = path.join(__dirname, '..');
  const out = path.join(root, 'renderer', 'generated');
  fs.mkdirSync(out, { recursive: true });
  await build({ entryPoints: [path.join(root, 'renderer/response-markdown.js')], outfile: path.join(out, 'response-markdown.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'ClarityMarkdown', minify: true, legalComments: 'linked' });
  const katex = path.join(root, 'node_modules/katex');
  fs.copyFileSync(path.join(katex, 'dist/katex.min.css'), path.join(out, 'katex.min.css'));
  fs.cpSync(path.join(katex, 'dist/fonts'), path.join(out, 'fonts'), { recursive: true });
  for (const [pkg, license] of [['katex', 'LICENSE'], ['markdown-it', 'LICENSE'], ['markdown-it-texmath', 'license.txt']]) {
    fs.copyFileSync(path.join(root, 'node_modules', pkg, license), path.join(out, `${pkg}-LICENSE.txt`));
  }
}
module.exports = { prepareRenderer };
if (require.main === module) prepareRenderer().catch(error => { console.error(error); process.exitCode = 1; });
