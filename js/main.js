document.addEventListener('DOMContentLoaded', () => {
  const fileInput       = document.getElementById('fileInput');
  const fileNameDisplay = document.getElementById('fileName');
  const output          = document.getElementById('output');
  const codeEl          = document.getElementById('outputCode');
  const copyBtn         = document.getElementById('copyBtn');

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
    if (['number','boolean'].includes(typeof x) || x === null) {
      return String(x);
    }
    if (Array.isArray(x)) {
      if (x.length === 0) return '[]';
      const items = x.map(i => pad + '  ' + toLiteral(i, indent + 2));
      return '[\n' + items.join(',\n') + '\n' + pad + ']';
    }
    const lines = Object.entries(x).map(
      ([k,v]) => pad + '  "'+k+'": ' + toLiteral(v, indent+2)
    );
    return '{\n' + lines.join(',\n') + '\n' + pad + '}';
  }

  /* Strip MathJax SVG → LaTeX */
  function stripMathJax(root) {
    // eliminamos estilos residuales
    root.querySelectorAll('style').forEach(s => s.remove());
    // buscamos cada contenedor SVG
    root.querySelectorAll('mjx-container[jax="SVG"]').forEach(mjx => {
      try {
        // 1) intentamos la anotación TeX
        let tex = mjx
          .querySelector('semantics > annotation[encoding="application/x-tex"]')
          ?.textContent
          ?.trim();
        // 2) si no hay, probamos aria-label
        if (!tex) tex = mjx.getAttribute('aria-label')?.trim();
        // 3) o el <title>
        if (!tex) tex = mjx.querySelector('title')?.textContent?.trim();
        if (!tex) {
          console.warn('MathJax sin anotación TeX:', mjx);
          mjx.remove();
          return;
        }
        const wrapped = tex.startsWith('\\(') || tex.startsWith('\\[') || tex.startsWith('$');
        const latex  = wrapped ? tex : `\\(${tex}\\)`;
        // reemplazamos el SVG por un nodo de texto con la TeX
        mjx.replaceWith(document.createTextNode(latex));
      } catch (e) {
        console.warn('Error al parsear MathJax:', e);
      }
    });
  }

function processContent(htmlString) {
  // 1) Parsear el HTML
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  stripMathJax(doc);

  // 2) Utilidad para evaluar XPaths y devolver nodos
  const nodesFromXPath = (xpath) => {
    const snap = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const arr = [];
    for (let i = 0; i < snap.snapshotLength; i++) arr.push(snap.snapshotItem(i));
    return arr;
  };

  // 3) XPaths de pasos de razonamiento y respuesta final
  const xpathRazonamiento =
    '//*[@id="root"]/div/div/div[1]/div[4]/div/div/div[3]/div[1]//div[h3]';
  const xpathFinal =
    '//*[@id="root"]/div/div/div[1]/div[4]/div/div/div[3]/div[2]//div[h3]';

  const nodosRazonamiento = nodesFromXPath(xpathRazonamiento);
  const nodosFinal = nodesFromXPath(xpathFinal);
  const todosLosNodos = nodosRazonamiento.concat(nodosFinal);

  const result = [];

  for (let i = 0; i < todosLosNodos.length; i++) {
    const card = todosLosNodos[i];

    const step = parseInt(card.querySelector('h3')?.textContent.replace(/\D/g, '') || '0', 10);
    const status = card.querySelector('.ant-tag')?.textContent.trim() || '';
    const isRegenerated = !!card.querySelector('.ant-tag-gold');

    const buttonsActual = card.querySelectorAll('button');
    const contentActual = buttonsActual[0]?.getAttribute('text') || '';

    let intervention = '';

    if (status === 'Rewrite') {
      /*  ───────────────────────────────
          Usamos XPath relativo al card para
          capturar el último <div class="markdown-body">
          (es donde está la intervención completa).
         ─────────────────────────────── */
      const mdNode = doc.evaluate(
        './/div[contains(@class,"markdown-body")][last()]',
        card,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;

      if (mdNode) intervention = mdNode.textContent.trim();
    } else if (status === 'Incorrect' || status === 'Criticize') {
      const cardPrev = todosLosNodos[i - 1];
      const contentPrev =
        cardPrev?.querySelectorAll('button')[0]?.getAttribute('text') || '';
      const rawActualInterv = buttonsActual[1]?.getAttribute('text') || '';
      const idx = rawActualInterv.indexOf(contentPrev);
      if (idx !== -1 && contentPrev.length)
        intervention = rawActualInterv.slice(idx + contentPrev.length).trim();
    } else {
      const rawInterv = buttonsActual[1]?.getAttribute('text') || '';
      const idx = rawInterv.indexOf(contentActual);
      if (idx !== -1 && contentActual.length)
        intervention = rawInterv.slice(idx + contentActual.length).trim();
    }

    // Campos adicionales label + contenido
    const text_fields = [];
    card
      .querySelectorAll('.ant-space-item > span[style*="font-weight"]')
      .forEach((lbl) => {
        const md = lbl
          .closest('.ant-space-item')
          ?.nextElementSibling?.querySelector('.markdown-body');
        if (md)
          text_fields.push({
            label: lbl.textContent.replace(/:$/, '').trim(),
            content: md.textContent.trim(),
          });
      });

    result.push({
      step_number: step,
      status,
      is_regenerated: isRegenerated,
      type: nodosRazonamiento.includes(card) ? 'reasoning' : 'final',
      content: contentActual,
      intervention,
      text_fields,
    });
  }

  // 4) Mostrar resultado
  codeEl.textContent =
    '[\n' + result.map((o) => '  ' + toLiteral(o, 2)).join(',\n') + '\n]';
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
