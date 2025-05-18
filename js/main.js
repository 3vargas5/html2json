document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const fileNameDisplay = document.getElementById('fileName');
    const output           = document.getElementById('output');
    const codeEl           = document.getElementById('outputCode');
  const copyBtn = document.getElementById('copyBtn');

  /* util: convert value → JS literal */
  function toLiteral(x, indent = 0) {
    const pad = ' '.repeat(indent);
    if (typeof x === 'string') {
      const s = x
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n');
      return `'${s}'`;
    }
    if (['number', 'boolean'].includes(typeof x) || x === null) return String(x);
    if (Array.isArray(x)) {
      if (!x.length) return '[]';
      const items = x.map(i => pad + '  ' + toLiteral(i, indent + 2));
      return '[\n' + items.join(',\n') + '\n' + pad + ']';
    }
    const lines = Object.entries(x).map(
      ([k, v]) => pad + '  "' + k + '": ' + toLiteral(v, indent + 2)
    );
    return '{\n' + lines.join(',\n') + '\n' + pad + '}';
  }

  /* Strip MathJax SVG → LaTeX */
  function stripMathJax(root) {
    root.querySelectorAll('style').forEach(s => s.remove());
    [...root.querySelectorAll('mjx-container[jax="SVG"]')].forEach(mjx => {
      try {
        let tex =
          mjx.querySelector('annotation[encoding="application/x-tex"]')?.textContent ||
          mjx.getAttribute('aria-label') ||
          mjx.querySelector('[aria-label]')?.getAttribute('aria-label') ||
          mjx.querySelector('title')?.textContent ||
          (() => {
            const chars = [...mjx.querySelectorAll('[data-c]')].map(
              u => String.fromCodePoint(parseInt(u.getAttribute('data-c'), 16))
            );
            return chars.length ? chars.join('') : null;
          })();
        tex = (tex || '').trim();
        const alreadyWrapped = /^\\\(|\\\[|\\$/.test(tex);
        const latex = tex && !alreadyWrapped ? `\\(${tex}\\)` : tex;
        mjx.parentNode?.replaceChild(document.createTextNode(latex), mjx);
      } catch (e) {
        console.warn('MathJax parse error', e);
      }
    });
  }

  function processContent(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    stripMathJax(doc);

    const cards = [...doc.querySelectorAll('.ant-card')];
    const result = cards.map(card => {
      const step = parseInt(
        card.querySelector('h3')?.textContent.replace(/\D/g, '') || '0',
        10
      );
      const status = card.querySelector('.ant-tag')?.textContent.trim() || '';
      const isRegenerated = !!card.querySelector('.ant-tag-gold');
      const content =
        card.querySelector('.code-wrapper .markdown-body')?.textContent.trim() || '';
      const text_fields = [];
      card.querySelectorAll('.ant-space-item > span[style*="font-weight"]').forEach(lbl => {
        const md =
          lbl.closest('.ant-space-item')
            ?.nextElementSibling
            ?.querySelector('.markdown-body');
        if (md)
          text_fields.push({
            label: lbl.textContent.replace(/:$/, '').trim(),
            content: md.textContent.trim(),
          });
      });
      return { step_number: step, status, is_regenerated: isRegenerated, content, text_fields };
    });

    codeEl.textContent = '[\n' + result.map(o => '  ' + toLiteral(o, 2)).join(',\n') + '\n]';
    // animation replay
    codeEl.classList.remove('reveal');
    void codeEl.offsetWidth;
    codeEl.classList.add('reveal');
    copyBtn.disabled = false;
    copyBtn.textContent = '❐';
  }

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    fileNameDisplay.textContent = file.name;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        processContent(ev.target.result);
        fileInput.value = '';
      } catch (err) {
        console.error(err);
        alert('Error processing HTML: ' + err.message);
      }
    };
    reader.onerror = () => {
      alert('Error reading file');
    };
    reader.readAsText(file);
  });

  copyBtn.addEventListener('click', async () => {
    if (copyBtn.disabled) return;
    try {
        await navigator.clipboard.writeText(codeEl.textContent);
      copyBtn.textContent = '✓';
      setTimeout(() => (copyBtn.textContent = '❐'), 1500);
    } catch (err) {
      alert('Copy failed: ' + err);
    }
  });
});
