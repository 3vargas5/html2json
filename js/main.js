document.addEventListener('DOMContentLoaded', () => {
  const fileInput       = document.getElementById('fileInput');
  const fileNameDisplay = document.getElementById('fileName');
  const output          = document.getElementById('output');
  const codeEl          = document.getElementById('outputCode');
  const copyBtn         = document.getElementById('copyBtn');
  const copyPromptBtn   = document.getElementById('copyPromptBtn');
  const slideWrapper    = document.getElementById('slideWrapper');

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

  if (typeof stripMathJax === 'function') {
    try { stripMathJax(doc); } catch (e) { console.warn("stripMathJax failed:", e); }
  }

  // 2) FUNCIONES AUXILIARES (getMarkdownForSuggestion ya no es necesaria si el botón es la prioridad)
  const nodesFromXPath = (xpath) => {
    const snap = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const arr = [];
    for (let i = 0; i < snap.snapshotLength; i++) arr.push(snap.snapshotItem(i));
    return arr;
  };
  const getTextFromButtonWithTooltip = (contextNode, tooltipValue, searchInAncestorSelector = null) => {
    if (!contextNode) return '';
    let searchBase = contextNode;
    if (searchInAncestorSelector) {
      const ancestor = contextNode.closest(searchInAncestorSelector);
      if (ancestor) searchBase = ancestor;
    }
    const specificBtn = searchBase.querySelector(`button[tooltip="${tooltipValue}"]`);
    return specificBtn?.getAttribute('text') || '';
  };
  const filterValidCardNodes = (nodos) => {
    return nodos.filter(nodo => {
      const h3Element = nodo.querySelector('h3');
      if (!h3Element || !h3Element.textContent.trim()) return false;
      const contentBtn = nodo.querySelector('button[tooltip="Copy Step"]');
      if (!contentBtn) return false;
      return true;
    });
  };
  // La función getMarkdownForSuggestion la podemos mantener por si la necesitamos para Criticize fallback,
  // o eliminarla si decidimos que el botón siempre es prioritario y suficiente.
  // Por ahora la mantendré por si el fallback de Criticize la usa.
  const getMarkdownForSuggestion = (cardBodyNode, suggestionLabelTextStart) => {
    if (!cardBodyNode) return null;
    const labels = cardBodyNode.querySelectorAll('.ant-flex .ant-typography[style*="font-weight"]');
    for (const label of labels) {
      if (label.textContent.trim().toLowerCase().startsWith(suggestionLabelTextStart.toLowerCase())) {
        const labelContainerItem = label.closest('.ant-space-item');
        if (labelContainerItem) {
          const markdownContainerItem = labelContainerItem.nextElementSibling;
          if (markdownContainerItem && markdownContainerItem.classList.contains('ant-space-item')) {
            const mdBody = markdownContainerItem.querySelector('.markdown-body');
            if (mdBody) return mdBody.textContent.trim();
          }
        }
      }
    }
    return null;
  };


  // 3) XPATHS Y OBTENCIÓN/FILTRADO DE NODOS PRINCIPALES
  const xpathRazonamiento = '//*[@id="root"]/div/div/div[1]/div[4]/div/div/div[3]/div[1]//div[h3]';
  const xpathFinal =    '//*[@id="root"]/div/div/div[1]/div[4]/div/div/div[3]/div[2]//div[h3]';
  const initialReasoningNodes = nodesFromXPath(xpathRazonamiento);
  const initialFinalNodes = nodesFromXPath(xpathFinal);
  const validReasoningNodes = filterValidCardNodes(initialReasoningNodes);
  const validFinalNodes = filterValidCardNodes(initialFinalNodes);
  const allValidNodes = validReasoningNodes.concat(validFinalNodes);

  if (allValidNodes.length === 0) {
    if (typeof codeEl !== 'undefined') codeEl.textContent = "[] // No se encontraron pasos o respuestas válidas.";
    if (typeof copyBtn !== 'undefined') copyBtn.disabled = true;
    return [];
  }

  // 4) PROCESAMIENTO DE CADA NODO/TARJETA VÁLIDO
  const result = [];
  for (let i = 0; i < allValidNodes.length; i++) {
    const card = allValidNodes[i];
    const cardBody = card.closest('.ant-card-body');

    const stepText = card.querySelector('h3')?.textContent || '0';
    const stepNumber = parseInt(stepText.replace(/\D/g, '') || '0', 10);
    const status = card.querySelector('.ant-tag')?.textContent.trim() || '';
    const isRegenerated = !!card.querySelector('.ant-tag-gold');
    const contentActual = getTextFromButtonWithTooltip(card, "Copy Step");
    let intervention = '';

    // ---- INICIO LÓGICA DE INTERVENCIÓN (REVISADA OTRA VEZ) ----

    // Prioridad 1 (Universal): Intentar con el botón "Copy Suggestion".
    // Esto se aplicará a Rewrite, Criticize, etc.
    intervention = getTextFromButtonWithTooltip(card, "Copy Suggestion", ".ant-card-body");

    // Prioridad 2: Si NO se obtuvo intervención del botón "Copy Suggestion",
    // aplicar lógicas de fallback específicas para cada status.
    if (!intervention) {
      const allButtonsWithinCard = card.querySelectorAll('button');
      const potentialInterventionTextFromSecondButton = allButtonsWithinCard[1]?.getAttribute('text') || '';

      if (status === 'Rewrite') {
        // Fallback para 'Rewrite': si "Copy Suggestion" falló, probar el markdown-body asociado a "Rewrite..."
        // O, si prefieres, el último markdown-body como antes.
        // Usaremos getMarkdownForSuggestion si la etiqueta es clara.
        const rewriteMarkdownText = getMarkdownForSuggestion(cardBody, "Rewrite");
        if (rewriteMarkdownText !== null) {
          intervention = rewriteMarkdownText;
        } else {
          // Fallback aún más profundo para Rewrite: el último markdown en el cardBody
          const searchNodeForRewriteFallback = cardBody || card;
          const markdownNode = doc.evaluate(
            './/div[contains(@class,"markdown-body")][last()]',
            searchNodeForRewriteFallback, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
          ).singleNodeValue;
          if (markdownNode) {
            intervention = markdownNode.textContent.trim();
          }
        }
      } else if (status === 'Incorrect') {
        const previousCard = allValidNodes[i - 1];
        const previousContent = previousCard ? getTextFromButtonWithTooltip(previousCard, "Copy Step") : '';
        const index = potentialInterventionTextFromSecondButton.indexOf(previousContent);
        if (index !== -1 && previousContent.length > 0) {
          intervention = potentialInterventionTextFromSecondButton.slice(index + previousContent.length).trim();
        } else if (index === -1 && previousContent.length === 0 && potentialInterventionTextFromSecondButton.length > 0) {
          intervention = potentialInterventionTextFromSecondButton.trim();
        } else if (index === -1 && potentialInterventionTextFromSecondButton.length > 0) {
          intervention = potentialInterventionTextFromSecondButton.trim();
        }
      } else if (status === 'Criticize') {
        // Fallback para 'Criticize' (si no hubo "Copy Suggestion"):
        if (potentialInterventionTextFromSecondButton && potentialInterventionTextFromSecondButton !== contentActual) {
          intervention = potentialInterventionTextFromSecondButton.trim();
        } else if (potentialInterventionTextFromSecondButton && potentialInterventionTextFromSecondButton === contentActual) {
          const criticizeMarkdownText = getMarkdownForSuggestion(cardBody, "Criticize");
          if (criticizeMarkdownText !== null && criticizeMarkdownText !== contentActual) {
             intervention = criticizeMarkdownText;
          }
        }
      }
    }
    
    // Prioridad 3: Fallback general (si no es Rewrite, Incorrect, Criticize y sigue sin intervención y hay contentActual).
    if (!intervention && contentActual.length > 0 && !['Rewrite', 'Incorrect', 'Criticize'].includes(status)) {
      const allButtonsWithinCard = card.querySelectorAll('button');
      const fallbackRawIntervention = allButtonsWithinCard[1]?.getAttribute('text') || '';
      const index = fallbackRawIntervention.indexOf(contentActual);
      if (index !== -1) {
        let tempIntervention = fallbackRawIntervention.slice(index + contentActual.length).trim();
        if (tempIntervention.length > 0 && tempIntervention !== contentActual) {
             intervention = tempIntervention;
        } else if (tempIntervention.length > 0 && fallbackRawIntervention !== contentActual){
             intervention = tempIntervention;
        }
      }
    }
    // ---- FIN LÓGICA DE INTERVENCIÓN ----

    result.push({
      step_number: stepNumber, status: status, is_regenerated: isRegenerated,
      type: validReasoningNodes.includes(card) ? 'reasoning' : 'final',
      content: contentActual, intervention: intervention,
    });
  }

  // 5) MOSTRAR RESULTADO
  if (typeof codeEl !== 'undefined' && typeof toLiteral === 'function' && typeof copyBtn !== 'undefined') {
    codeEl.textContent = '[\n' + result.map((o) => '  ' + toLiteral(o, 2)).join(',\n') + '\n]';
    codeEl.classList.remove('reveal'); void codeEl.offsetWidth; codeEl.classList.add('reveal');
    copyBtn.disabled = (result.length === 0); copyBtn.textContent = 'Copy JSON';
    if (copyPromptBtn) copyPromptBtn.disabled = (result.length === 0);
  }
  return result;
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
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy JSON'), 1500);
    } catch (err) {
      alert('Copy failed: ' + err);
    }
  });

  if (copyPromptBtn) {
    copyPromptBtn.addEventListener('click', () => {
      slideWrapper?.classList.add('show-form');
    });
  }
});
