const MarkdownIt = require('markdown-it');
const texmath = require('markdown-it-texmath');
const katex = require('katex');

function renderMarkdown(text) {
  // Fresh macros per response: model output must not redefine later responses.
  const options = { trust: false, throwOnError: false, strict: 'ignore', maxExpand: 1000, maxSize: 20, macros: {} };
  const md = new MarkdownIt({ html: false, breaks: true, linkify: false })
    .use(texmath, { engine: katex, delimiters: ['dollars', 'brackets', 'beg_end'], katexOptions: options });
  // Images from model text are not fetched; explicit screen capture is separate.
  md.disable('image');
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, ...args) => {
    const token = tokens[index];
    if (/^(math|latex|tex)$/i.test(token.info.trim())) {
      return '<div class="math-block">' + katex.renderToString(token.content, { ...options, displayMode: true }) + '</div>';
    }
    return fence(tokens, index, ...args);
  };
  return md.render(String(text || ''));
}
module.exports = { renderMarkdown };
