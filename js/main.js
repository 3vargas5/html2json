document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const fileNameDisplay = document.getElementById('fileName');
  // const output = document.getElementById('output'); // Parece no usarse, lo comento por si acaso
  const codeEl = document.getElementById('outputCode');
  const copyBtn = document.getElementById('copyBtn');

  // Elementos del DOM para el menú de feedback
  const openFeedbackMenuBtn = document.getElementById('openFeedbackMenuBtn');
  const feedbackMenu = document.getElementById('feedbackMenu');
  const problemStatementTextarea = document.getElementById('problemStatement');
  const solutionSuggestionCheckbox = document.getElementById('solutionSuggestionCheckbox');
  const solutionSuggestTextarea = document.getElementById('solutionSuggest');
  const copyFeedbackBtn = document.getElementById('copyFeedbackBtn');

  // --- ICONOS FONT AWESOME ---
  const ICON_COPY = '<i class="fas fa-copy"></i>'; // Icono de copiar estándar
  const ICON_CHECK = '<i class="fas fa-check"></i>'; // Icono de check (copiado)
  // Para el botón de feedback, podrías querer un icono más específico o texto + icono
  // Ejemplo: '<i class="fas fa-clipboard-list"></i> Copiar Feedback';
  // Por ahora, usaremos uno de copiar también, pero puedes personalizarlo.
  const ICON_FEEDBACK_COPY_DEFAULT_TEXT = copyFeedbackBtn.innerHTML; // Guardar el texto original del botón si lo tiene
  const ICON_FEEDBACK_COPY = '<i class="fas fa-clipboard-check"></i>'; // Un icono diferente para el feedback
                                                                    // o puedes usar ICON_COPY si prefieres

  // Inicializar el botón de copiar principal con el icono
  if (copyBtn) {
    copyBtn.innerHTML = ICON_COPY;
    copyBtn.disabled = true; // Inicialmente deshabilitado
  }

  // Inicializar el botón de copiar feedback si existe y quieres cambiar su contenido inicial
  // Si el botón ya tiene texto y solo quieres AÑADIR un icono, la lógica sería diferente.
  // Por ahora, asumimos que queremos reemplazar su contenido con un icono + texto (o solo icono).
  // Si el botón `copyFeedbackBtn` ya tiene texto en el HTML que quieres conservar con un icono al lado:
  // const originalFeedbackBtnText = copyFeedbackBtn.textContent.trim();
  // const defaultFeedbackBtnHTML = `<i class="fas fa-paper-plane"></i> ${originalFeedbackBtnText}`;
  // Si quieres reemplazarlo completamente o el botón está vacío:
  const defaultFeedbackBtnHTML = `<i class="fas fa-clipboard"></i> Copy Prompt`; // Ejemplo con icono y texto
  if (copyFeedbackBtn) {
    copyFeedbackBtn.innerHTML = defaultFeedbackBtnHTML;
  }


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
    root.querySelectorAll('style').forEach(s => s.remove());
    root.querySelectorAll('mjx-container[jax="SVG"]').forEach(mjx => {
      try {
        let tex = mjx
          .querySelector('semantics > annotation[encoding="application/x-tex"]')
          ?.textContent
          ?.trim();
        if (!tex) tex = mjx.getAttribute('aria-label')?.trim();
        if (!tex) tex = mjx.querySelector('title')?.textContent?.trim();
        if (!tex) {
          console.warn('MathJax sin anotación TeX:', mjx);
          mjx.remove();
          return;
        }
        const wrapped = tex.startsWith('\\(') || tex.startsWith('\\[') || tex.startsWith('$');
        const latex  = wrapped ? tex : `\\(${tex}\\)`;
        mjx.replaceWith(document.createTextNode(latex));
      } catch (e) {
        console.warn('Error al parsear MathJax:', e);
      }
    });
  }

  function processContent(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');

    if (typeof stripMathJax === 'function') {
        try { stripMathJax(doc); } catch (e) { console.warn("stripMathJax failed:", e); }
    }
    
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
    
    const xpathRazonamiento = '//*[@id="root"]/div/div/div[1]/div[4]/div/div/div[3]/div[1]//div[h3]';
    const xpathFinal =    '//*[@id="root"]/div/div/div[1]/div[4]/div/div/div[3]/div[2]//div[h3]';
    const initialReasoningNodes = nodesFromXPath(xpathRazonamiento);
    const initialFinalNodes = nodesFromXPath(xpathFinal);
    const validReasoningNodes = filterValidCardNodes(initialReasoningNodes);
    const validFinalNodes = filterValidCardNodes(initialFinalNodes);
    const allValidNodes = validReasoningNodes.concat(validFinalNodes);

    if (allValidNodes.length === 0) {
      if (typeof codeEl !== 'undefined') codeEl.textContent = "[] // No se encontraron pasos o respuestas válidas.";
      if (typeof copyBtn !== 'undefined') {
        copyBtn.disabled = true;
        copyBtn.innerHTML = ICON_COPY; // Restaurar icono por si acaso
      }
      if (typeof openFeedbackMenuBtn !== 'undefined') openFeedbackMenuBtn.style.display = 'none'; 
      return [];
    }

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

        intervention = getTextFromButtonWithTooltip(card, "Copy Suggestion", ".ant-card-body");

        if (!intervention) {
        const allButtonsWithinCard = card.querySelectorAll('button');
        const potentialInterventionTextFromSecondButton = allButtonsWithinCard[1]?.getAttribute('text') || '';

        if (status === 'Rewrite') {
            const rewriteMarkdownText = getMarkdownForSuggestion(cardBody, "Rewrite");
            if (rewriteMarkdownText !== null) {
            intervention = rewriteMarkdownText;
            } else {
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

        result.push({
        step_number: stepNumber, status: status, is_regenerated: isRegenerated,
        type: validReasoningNodes.includes(card) ? 'reasoning' : 'final',
        content: contentActual, intervention: intervention,
        });
    }

    if (typeof codeEl !== 'undefined' && typeof toLiteral === 'function' && typeof copyBtn !== 'undefined') {
      codeEl.textContent = '[\n' + result.map((o) => '  ' + toLiteral(o, 2)).join(',\n') + '\n]';
      codeEl.classList.remove('reveal'); void codeEl.offsetWidth; codeEl.classList.add('reveal');
      copyBtn.disabled = (result.length === 0);
      copyBtn.innerHTML = ICON_COPY; // Cambiado de textContent a innerHTML
      
      if (result.length > 0) {
        openFeedbackMenuBtn.style.display = 'grid';
      } else {
        openFeedbackMenuBtn.style.display = 'none';
      }
    }
    return result;
  }

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) {
        fileNameDisplay.textContent = 'No file selected';
        codeEl.textContent = 'The JavaScript string literal will appear here…';
        if (copyBtn) {
            copyBtn.disabled = true;
            copyBtn.innerHTML = ICON_COPY; // Restaurar icono
        }
        openFeedbackMenuBtn.style.display = 'none';
        feedbackMenu.classList.remove('active');
        problemStatementTextarea.value = '';
        solutionSuggestTextarea.value = '';
        solutionSuggestionCheckbox.checked = false;
        solutionSuggestTextarea.disabled = true;
        return;
    }
    fileNameDisplay.textContent = file.name;
    
    openFeedbackMenuBtn.style.display = 'none';
    feedbackMenu.classList.remove('active');
    problemStatementTextarea.value = '';
    solutionSuggestTextarea.value = '';
    solutionSuggestionCheckbox.checked = false;
    solutionSuggestTextarea.disabled = true;

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        processContent(ev.target.result);
        fileInput.value = ''; 
      } catch (err) {
        console.error(err);
        alert('Error processing HTML: ' + err.message);
        openFeedbackMenuBtn.style.display = 'none'; 
      }
    };
    reader.onerror = () => {
      alert('Error reading file');
      openFeedbackMenuBtn.style.display = 'none'; 
    };
    reader.readAsText(file);
  });

  copyBtn.addEventListener('click', async () => {
    if (copyBtn.disabled) return;
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      copyBtn.innerHTML = ICON_CHECK; // Cambiado de textContent a innerHTML
      setTimeout(() => (copyBtn.innerHTML = ICON_COPY), 1500); // Restaurar icono
    } catch (err) {
      alert('Copy failed: ' + err);
    }
  });

  // --- LÓGICA PARA EL MENÚ DE FEEDBACK ---

  openFeedbackMenuBtn.addEventListener('click', () => {
    feedbackMenu.classList.toggle('active');
  });

  solutionSuggestionCheckbox.addEventListener('change', () => {
    solutionSuggestTextarea.disabled = !solutionSuggestionCheckbox.checked;
    if (!solutionSuggestionCheckbox.checked) {
      solutionSuggestTextarea.value = ''; 
    }
  });

  copyFeedbackBtn.addEventListener('click', async () => {
    const problemStatement = problemStatementTextarea.value.trim();
    const jsonContent = codeEl.textContent.trim(); 
    const provideOptionalSolution = solutionSuggestionCheckbox.checked;
    const optionalSolution = solutionSuggestTextarea.value.trim();

    if (!problemStatement) {
        alert("Problem statement is required to generate the prompt.");
        problemStatementTextarea.focus();
        return;
    }
    if (!jsonContent || jsonContent.startsWith("[] //") || jsonContent.startsWith("The JavaScript string literal will appear here…")) {
        alert("JSON content is not available. Please process an HTML file first.");
        return;
    }

    let optionalSolutionSection = '';
    if (provideOptionalSolution && optionalSolution) {
        optionalSolutionSection = `
• Optional complete reference solution (context only; leave blank if none):
"""
${optionalSolution}
"""
`;
    }

    const finalPrompt = `You are a rigorous mathematics proof checker.
# INPUT

• Problem statement (verbatim):
"""
${problemStatement}
"""

• JSON chain of reasoning (one object per step):
\`\`\`json
${jsonContent}
\`\`\`
${optionalSolutionSection}
# TASK

Read the chain in ascending order of \`step_number\` and evaluate each entry according to its "status" value.

## STATUS VALUES
- "Correct" the step claims to be fully valid.  
- "Criticize" the step points out an earlier flaw.  
- "Incorrect" the step replaces faulty reasoning with a fix.  
- "" (empty) treat exactly as "Correct" and inspect rigorously.  
Any other value is treated as "Incorrect".

## EVALUATION PROCEDURE
1. **Steps marked "Correct" (or empty)**  
   • Verify every computation, definition, deduction and edge case rigorously.  
   • Confirm any claim of optimality or minimality is proven.  
   • If you find an error, treat the step as faulty and report it as in §5.

2. **Steps marked "Criticize" or "Incorrect"**  
   The step's \`intervention\` must satisfy: 
   | Label | Required content |
   |-------|------------------|
   | Criticize | A specific, correct mathematical flaw in the target step, quoted or pinpointed. No hint must be provided, only be used to critique the model's mistakes. (What is wrong and, optionally, why it is wrong).|
   | Incorrect | A fully corrected version of the faulty reasoning or calculation. |
   
	- When a step is marked as \`Incorrect\`, the \`intervention\` section must contain only the specific correction of the mistaken calculation or reasoning in that step; it must not include final conclusions or solve parts that do not directly relate to the erroneous fragment.
   
	- Not include any hints or instructions on how to solve the problem in \`intervention\` when the step is marked as \`Criticize\`.

	- An \`intervention\` when the step is marked as \`Criticize\` should only be used to critique the model's mistakes. (What is wrong and, optionally, why it is wrong). Prefer that any instructions on what to do to be given only in interventions when the step is marked as \`Incorrect\`.
	
	- The \`intervention\` in steps marked as \`Criticize\` should only be used to point out the model’s mistakes—what’s wrong and, optionally, why it’s wrong.


3. **Self‑corrections**  
   If an earlier flaw is explicitly fixed by a later "Criticize" or "Incorrect", regard the earlier flaw as superseded and do **not** flag it.

4. **Stop criterion**  
   Traverse the steps until you reach the first error that is *not* later superseded.  
   If no unfixed errors exist, output exactly:
\`\`\`

Step: –
No errors found

\`\`\`

5. **Fault report format**  
When you stop on an error, output **only**:  
• **Step:** <step_number>  
• **Status:** <status> 
• **Error type:** <label from taxonomy>  
• **Large and clear explanation:** 1–3 sentences quoting the erroneous expression or argument and explaining *where* and *why* it is wrong.  
• **Correction suggestion:** *(optional, ≤20words)*

6. **Reference solution**  
Ignore the reference solution block if blank. If it is present, you may read it for context **but never judge its correctness or copy text from it**.

## ERROR TAXONOMY
arithmetic error | logical error | notation/definition error | vague or wrong critique | inadequate correction | variable‑mapping error | external‑theorem misuse | formula/general‑solution missing | interpretation error | lack of exhaustiveness | lack of optimality/minimality proof | generalization not justified | construction incomplete  

## EXAMPLE OUTPUT
\`\`\`
Step: 6  
Status: Criticize
Error type: arithmetic error  
Large and clear explanation: τ(3465) was stated as 20, but prime factorisation 3²·5·7·11 gives τ=(2+1)(1+1)(1+1)(1+1)=24.  
Correction suggestion: Recalculate τ(3465) with four prime factors.
\`\`\`
`;

    try {
      await navigator.clipboard.writeText(finalPrompt.trim());
      // Guardar el contenido actual del botón para restaurarlo
      // const originalButtonHTML = copyFeedbackBtn.innerHTML; // Ya lo guardamos en defaultFeedbackBtnHTML
      copyFeedbackBtn.innerHTML = `${ICON_CHECK} Prompt Copied!`; // Usar el icono de check y un texto
      setTimeout(() => {
        copyFeedbackBtn.innerHTML = defaultFeedbackBtnHTML; // Restaurar el contenido original con icono
        feedbackMenu.classList.remove('active'); 
      }, 1500);
    } catch (err) {
      console.error('Failed to copy prompt: ', err);
      alert('Failed to copy prompt: ' + err.message);
    }
  });

  document.addEventListener('click', (event) => {
    if (feedbackMenu.classList.contains('active') && 
        !feedbackMenu.contains(event.target) && 
        !openFeedbackMenuBtn.contains(event.target)) {
      feedbackMenu.classList.remove('active');
    }
  });

});