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

  // Ejecutar stripMathJax si está disponible
  if (typeof stripMathJax === 'function') {
    try {
      stripMathJax(doc);
    } catch (e) {
      // No es crítico si falla, pero es bueno saberlo si se espera que funcione.
      console.warn("stripMathJax function was found but failed to execute:", e);
    }
  }

  // 2) FUNCIONES AUXILIARES

  /**
   * Evalúa un XPath y devuelve un array de nodos encontrados.
   * @param {string} xpath La expresión XPath a evaluar.
   * @returns {Node[]} Un array de nodos.
   */
  const nodesFromXPath = (xpath) => {
    const snap = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const arr = [];
    for (let i = 0; i < snap.snapshotLength; i++) {
      arr.push(snap.snapshotItem(i));
    }
    return arr;
  };

  /**
   * Obtiene el valor del atributo 'text' de un botón específico identificado por su 'tooltip'.
   * Puede buscar el botón directamente en contextNode o en un ancestro de contextNode.
   * @param {Node} contextNode El nodo desde donde iniciar la búsqueda.
   * @param {string} tooltipValue El valor del atributo 'tooltip' del botón buscado.
   * @param {string|null} searchInAncestorSelector Selector CSS del ancestro donde buscar. Si es null, busca en contextNode.
   * @returns {string} El valor del atributo 'text' del botón, o string vacío si no se encuentra.
   */
  const getTextFromButtonWithTooltip = (contextNode, tooltipValue, searchInAncestorSelector = null) => {
    if (!contextNode) return '';

    let searchBase = contextNode;
    if (searchInAncestorSelector) {
      const ancestor = contextNode.closest(searchInAncestorSelector);
      if (ancestor) {
        searchBase = ancestor;
      }
      // Si no se encuentra el ancestro, searchBase permanece como contextNode,
      // lo que significa que la búsqueda se limitará al nodo original.
      // Esto es un fallback razonable si la estructura esperada no está presente.
    }

    const specificBtn = searchBase.querySelector(`button[tooltip="${tooltipValue}"]`);
    return specificBtn?.getAttribute('text') || '';
  };

  /**
   * Filtra una lista de nodos para mantener solo aquellos que representan "tarjetas" válidas.
   * Una tarjeta válida debe tener un h3 con texto y un botón "Copy Step".
   * @param {Node[]} nodos Array de nodos candidatos.
   * @returns {Node[]} Array de nodos filtrados.
   */
  const filterValidCardNodes = (nodos) => {
    return nodos.filter(nodo => {
      const h3Element = nodo.querySelector('h3');
      if (!h3Element || !h3Element.textContent.trim()) {
        return false; // Debe tener un h3 con texto
      }
      // Asumimos que una tarjeta válida para ser procesada como paso debe tener el botón "Copy Step"
      const contentBtn = nodo.querySelector('button[tooltip="Copy Step"]');
      if (!contentBtn) {
        return false; // Debe tener el botón del contenido principal
      }
      return true;
    });
  };

  // 3) XPATHS Y OBTENCIÓN/FILTRADO DE NODOS PRINCIPALES

  // Estos XPaths identifican los contenedores de los pasos de razonamiento y la respuesta final,
  // y luego buscan divs que contengan un h3 (que se asume son las tarjetas de cada paso).
  const xpathRazonamiento = '//*[@id="root"]/div/div/div[1]/div[4]/div/div/div[3]/div[1]//div[h3]';
  const xpathFinal =    '//*[@id="root"]/div/div/div[1]/div[4]/div/div/div[3]/div[2]//div[h3]';

  const initialReasoningNodes = nodesFromXPath(xpathRazonamiento);
  const initialFinalNodes = nodesFromXPath(xpathFinal);

  const validReasoningNodes = filterValidCardNodes(initialReasoningNodes);
  const validFinalNodes = filterValidCardNodes(initialFinalNodes);

  const allValidNodes = validReasoningNodes.concat(validFinalNodes);

  // Si no se encontraron nodos válidos, no hay nada que procesar.
  if (allValidNodes.length === 0) {
    if (typeof codeEl !== 'undefined') {
      codeEl.textContent = "[] // No se encontraron pasos o respuestas válidas para procesar.";
    }
    if (typeof copyBtn !== 'undefined') {
      copyBtn.disabled = true;
    }
    return []; // Devuelve un array vacío o maneja como prefieras
  }

  // 4) PROCESAMIENTO DE CADA NODO/TARJETA VÁLIDO

  const result = [];
  for (let i = 0; i < allValidNodes.length; i++) {
    const card = allValidNodes[i]; // 'card' es el div que contiene el h3 y se considera un paso/tarjeta

    const stepText = card.querySelector('h3')?.textContent || '0';
    const stepNumber = parseInt(stepText.replace(/\D/g, '') || '0', 10);
    const status = card.querySelector('.ant-tag')?.textContent.trim() || '';
    const isRegenerated = !!card.querySelector('.ant-tag-gold');

    // El contenido principal del paso se toma del botón "Copy Step" DENTRO de la 'card'
    const contentActual = getTextFromButtonWithTooltip(card, "Copy Step");
    let intervention = '';

    // Lógica para extraer la 'intervention'
    // Prioridad 1: Si es 'Rewrite', la intervención viene del último markdown-body en el .ant-card-body ancestro.
    if (status === 'Rewrite') {
      const searchNodeForRewrite = card.closest('.ant-card-body') || card;
      const markdownNode = doc.evaluate(
        './/div[contains(@class,"markdown-body")][last()]', // XPath relativo al nodo de búsqueda
        searchNodeForRewrite,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (markdownNode) {
        intervention = markdownNode.textContent.trim();
      }
    }

    // Prioridad 2: Si no se obtuvo intervención (o no era 'Rewrite'),
    // intentar con el botón "Copy Suggestion" buscado en el .ant-card-body ancestro.
    if (!intervention) {
      intervention = getTextFromButtonWithTooltip(card, "Copy Suggestion", ".ant-card-body");
    }

    // Prioridad 3: Si aún no hay intervención, aplicar lógicas de fallback para 'Incorrect' o 'Criticize'.
    if (!intervention) {
      const allButtonsWithinCard = card.querySelectorAll('button'); // Botones DENTRO de la 'card' (div con h3)
      // Se asume que el segundo botón dentro de la 'card' puede contener la intervención o una mezcla.
      const potentialInterventionTextFromSecondButton = allButtonsWithinCard[1]?.getAttribute('text') || '';

      if (status === 'Incorrect') {
        const previousCard = allValidNodes[i - 1];
        const previousContent = previousCard ? getTextFromButtonWithTooltip(previousCard, "Copy Step") : '';
        
        const index = potentialInterventionTextFromSecondButton.indexOf(previousContent);
        if (index !== -1 && previousContent.length > 0) {
          intervention = potentialInterventionTextFromSecondButton.slice(index + previousContent.length).trim();
        } else if (index === -1 && previousContent.length === 0 && potentialInterventionTextFromSecondButton.length > 0) {
          // Si no hay contenido previo (ej. primer paso es incorrecto), tomar todo el texto del segundo botón.
          intervention = potentialInterventionTextFromSecondButton.trim();
        } else if (index === -1 && potentialInterventionTextFromSecondButton.length > 0) {
          // Si el contenido previo no se encontró pero el segundo botón tiene texto, tómalo entero.
          // Esto puede necesitar revisión si la estructura es más compleja.
          intervention = potentialInterventionTextFromSecondButton.trim();
        }
      } else if (status === 'Criticize') {
        // Para 'Criticize' sin "Copy Suggestion", se intenta usar el texto del segundo botón
        // si es diferente del contenido actual, o el último markdown-body del ancestro.
        if (potentialInterventionTextFromSecondButton && potentialInterventionTextFromSecondButton !== contentActual) {
          intervention = potentialInterventionTextFromSecondButton.trim();
        } else if (potentialInterventionTextFromSecondButton && potentialInterventionTextFromSecondButton === contentActual) {
          const searchNodeForCriticizeMarkdown = card.closest('.ant-card-body') || card;
          const markdownNode = doc.evaluate(
            './/div[contains(@class,"markdown-body")][last()]',
            searchNodeForCriticizeMarkdown,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          ).singleNodeValue;
          if (markdownNode && markdownNode.textContent.trim() !== contentActual) {
            intervention = markdownNode.textContent.trim();
          }
          // Si no, la intervención permanece vacía para Criticize en este fallback.
        }
        // Si no, la intervención permanece vacía.
      }
    }
    
    // Prioridad 4: Fallback general si TODAVÍA no hay intervención, no es un status especial, y hay contentActual.
    // Compara el contentActual con el texto del SEGUNDO botón DENTRO de la 'card'.
    if (!intervention && contentActual.length > 0 && status !== 'Rewrite' && status !== 'Incorrect' && status !== 'Criticize') {
      const allButtonsWithinCard = card.querySelectorAll('button');
      const fallbackRawIntervention = allButtonsWithinCard[1]?.getAttribute('text') || '';
      const index = fallbackRawIntervention.indexOf(contentActual);
      if (index !== -1) {
        let tempIntervention = fallbackRawIntervention.slice(index + contentActual.length).trim();
        // Asegurarse de que la intervención calculada es realmente diferente o algo se añadió.
        if (tempIntervention.length > 0 && tempIntervention !== contentActual) {
             intervention = tempIntervention;
        } else if (tempIntervention.length > 0 && fallbackRawIntervention !== contentActual){
             // Este caso es si tempIntervention ES contentActual, pero el original era más largo.
             intervention = tempIntervention;
        }
      }
    }

    result.push({
      step_number: stepNumber,
      status: status,
      is_regenerated: isRegenerated,
      type: validReasoningNodes.includes(card) ? 'reasoning' : 'final',
      content: contentActual,
      intervention: intervention,
    });
  }

  // 5) MOSTRAR RESULTADO (o devolverlo)
  // Estas variables (codeEl, toLiteral, copyBtn) deben estar definidas en el ámbito donde se llama a processContent.
  if (typeof codeEl !== 'undefined' && typeof toLiteral === 'function' && typeof copyBtn !== 'undefined') {
    codeEl.textContent =
      '[\n' + result.map((o) => '  ' + toLiteral(o, 2)).join(',\n') + '\n]';
    codeEl.classList.remove('reveal');
    void codeEl.offsetWidth; // Forzar reflow para reinicio de animación CSS
    codeEl.classList.add('reveal');
    copyBtn.disabled = (result.length === 0);
    copyBtn.textContent = '❐'; // O el ícono/texto de copiar que uses
  } else {
    // Si no se van a usar estos elementos para mostrar, al menos advertir o manejar de otra forma.
    // console.warn("Elementos para mostrar resultado (codeEl, toLiteral, copyBtn) no están definidos en este ámbito.");
  }

  return result; // Devuelve el array de resultados procesados.
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