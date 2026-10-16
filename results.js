(function () {
  const match = location.pathname.match(/^\/contest\/(\d+)\/results\/(\d+)\/?$/);
  if (!match) return;
  const [, contestId, submitId] = match;
  const S = SatoriSolver;

  const EXPLAIN_PROMPT = `You are an experienced competitive programming mentor helping a student on Satori, the online judge of Jagiellonian University (TCS UJ).

You will get the problem statement, the contest news, the student's submitted code, its judge status and the checking report. Explain what is wrong with the code:
- Point to the exact places (quote the relevant lines or name the function/variable) that cause the failure.
- Connect each bug to the report: which tests fail and why (wrong answer, too slow, too much memory, crash, compilation error). Test 0 is usually the sample from the statement; the last tests are usually the large ones.
- Give concrete counterexamples or input patterns that break the code, when possible.
- Say how to fix each problem, with short code snippets for the changed parts only. Do not rewrite the whole solution.
- If the status is OK, say so and mention any remaining risks (edge cases, performance margins) briefly.

Be concise and structured. Use Markdown: short headings, bullet lists and fenced code blocks. Answer in the same language as the problem statement.`;

  const CARD_CSS = `
    .card {
      margin: 18px 0; max-width: 900px; overflow: hidden; border-radius: 18px;
      background: #0f172a; color: #e2e8f0; border: 1px solid rgba(148, 163, 184, .18);
      box-shadow: 0 18px 44px rgba(2, 6, 23, .35); font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
      animation: pop .3s cubic-bezier(.2, .9, .3, 1.2);
    }
    @keyframes pop { from { opacity: 0; transform: translateY(12px) scale(.98); } }
    header {
      display: flex; align-items: center; gap: 12px; padding: 12px 18px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #ec4899); color: #fff;
    }
    .title { flex: 1; font-size: 16px; font-weight: 800; }
    .chip { background: rgba(255, 255, 255, .22); border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
    .close { border: 0; background: transparent; color: #fff; font-size: 18px; line-height: 1; cursor: pointer; opacity: .8; }
    .close:hover { opacity: 1; }
    .body { padding: 14px 20px 18px; }
    .status { color: #94a3b8; font-size: 13px; }
    .status.err { color: #fca5a5; }
    .status:empty { display: none; }
    .answer:empty { display: none; }
    .answer h2, .answer h3, .answer h4 { margin: 14px 0 6px; color: #c4b5fd; font-size: 15px; }
    .answer p { margin: 6px 0; }
    .answer ul, .answer ol { margin: 6px 0; padding-left: 22px; }
    .answer li { margin: 2px 0; }
    .answer code { font: 12.5px ui-monospace, Consolas, monospace; background: #1e293b; border-radius: 5px; padding: 1px 5px; color: #fde68a; }
    .answer pre { background: #020617; border: 1px solid #334155; border-radius: 10px; padding: 10px 12px; overflow: auto; }
    .answer pre code { background: none; padding: 0; color: #e2e8f0; }
    .answer strong { color: #fff; }
    .usage { margin-top: 12px; color: #fde68a; font-size: 12px; }
    .usage:empty { display: none; }
    .spinner { display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -1px; border-radius: 50%;
      border: 2px solid rgba(148, 163, 184, .3); border-top-color: #a78bfa; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  // Minimalny Markdown -> HTML (nagłówki, listy, bloki kodu, `kod`, **pogrubienie**).
  function renderMarkdown(md) {
    const inline = (s) => S.escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    const lines = md.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        closeList();
        const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        out.push(`<pre><code>${S.escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      const ul = line.match(/^\s*[-*]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (h) { closeList(); out.push(`<h${Math.min(4, h[1].length + 1)}>${inline(h[2])}</h${Math.min(4, h[1].length + 1)}>`); }
      else if (ul || ol) {
        const kind = ul ? 'ul' : 'ol';
        if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
        out.push(`<li>${inline((ul || ol)[1])}</li>`);
      } else if (line.trim()) { closeList(); out.push(`<p>${inline(line)}</p>`); }
      else closeList();
    }
    closeList();
    return out.join('');
  }

  function submitInfo() {
    const row = document.querySelectorAll('#content table.results tr')[1];
    const cells = row ? row.querySelectorAll('td') : [];
    return { problemCode: cells[2] ? cells[2].textContent.trim() : '', status: cells[4] ? cells[4].textContent.trim() : '' };
  }

  async function getCode() {
    const link = Array.from(document.querySelectorAll('#content a')).find((a) => /\/download\/Submit\//.test(a.getAttribute('href') || ''));
    if (!link) throw new Error('Nie znalazłem kodu tego submitu na stronie.');
    const res = await fetch(link.href, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Pobieranie kodu: HTTP ${res.status}`);
    return { filename: link.getAttribute('href').split('/').pop(), code: await res.text() };
  }

  // Kod zadania (np. "G02") -> id zadania, z listy zadań contestu.
  async function findProblemId(problemCode) {
    const { doc } = await S.fetchDoc(`/contest/${contestId}/problems`);
    for (const tr of doc.querySelectorAll('table.results tr')) {
      const link = tr.querySelector('a[href*="/problems/"]');
      const td = tr.querySelector('td');
      const id = link && link.getAttribute('href').match(/\/problems\/(\d+)/);
      if (id && td && td.textContent.trim() === problemCode) return id[1];
    }
    return null;
  }

  function createCard(anchor, info) {
    document.getElementById('satori-explain-host')?.remove();
    const host = document.createElement('div');
    host.id = 'satori-explain-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${CARD_CSS}</style>
      <div class="card">
        <header>
          <span class="title">🔍 Explain bug</span>
          <span class="chip">${S.escapeHtml(info.problemCode)} · ${S.escapeHtml(info.status || '?')}</span>
          <button class="close" data-role="close" title="Zamknij">✕</button>
        </header>
        <div class="body">
          <div class="status" data-role="status"></div>
          <div class="answer" data-role="answer"></div>
          <div class="usage" data-role="usage"></div>
        </div>
      </div>`;
    anchor.after(host);
    const $ = (role) => root.querySelector(`[data-role="${role}"]`);
    let closed = false;
    $('close').addEventListener('click', () => { closed = true; host.remove(); });
    return {
      get closed() { return closed; },
      status(html, kind) { $('status').innerHTML = html; $('status').className = `status ${kind || ''}`; },
      answer(md) { $('answer').innerHTML = renderMarkdown(md); },
      usage(text) { $('usage').textContent = `💰 ${text}`; },
    };
  }

  let running = false;

  async function explain(button, anchor) {
    if (running) return;
    running = true;
    button.classList.add('busy');
    const info = submitInfo();
    const ui = createCard(anchor, info);
    try {
      ui.status('<span class="spinner"></span>Czytam kod, raport, treść zadania i newsy...');
      const problemId = await findProblemId(info.problemCode).catch(() => null);
      const [solution, statement, news, settings] = await Promise.all([
        getCode(),
        problemId ? S.getStatement(contestId, problemId) : Promise.resolve(''),
        S.getNews(contestId).catch(() => []),
        chrome.storage.local.get(SETTINGS_DEFAULTS),
      ]);
      const report = S.reportFromDoc(document);

      const prompt = S.buildPrompt(info.problemCode, statement || '(statement not available)', news, '')
        + `\n\n# Submitted code: ${solution.filename}\n\n\`\`\`\n${solution.code}\n\`\`\``
        + `\n\n# Judge status: ${info.status || 'unknown'}\n\n# Checking report\n\n${report}`
        + '\n\nExplain what is wrong with this code.';

      const t0 = Date.now();
      const result = await S.generate(EXPLAIN_PROMPT, [{ role: 'user', content: prompt }], (msg) => {
        if (msg.type !== 'progress' || ui.closed) return;
        const secs = Math.round((Date.now() - t0) / 1000);
        if (msg.text) { ui.answer(msg.text); ui.status(`<span class="spinner"></span>Piszę... ${secs}s`); }
        else ui.status(`<span class="spinner"></span>Analizuję kod... ${secs}s · thinking ${msg.thinkingChars} zn.`);
      });
      if (ui.closed) return;
      ui.answer(result.text);
      ui.status(result.stopReason === 'max_tokens' ? 'Odpowiedź ucięta limitem tokenów - zwiększ "Max tokenów" w opcjach.' : '',
        result.stopReason === 'max_tokens' ? 'err' : '');
      const usage = S.addUsage(S.emptyUsage(), result.usage);
      ui.usage(S.formatUsage(usage, S.costOf(usage, settings.model, settings.prices)));
    } catch (e) {
      ui.status(S.escapeHtml(e.message), 'err');
      console.error('[satori-explain]', e);
    } finally {
      running = false;
      button.classList.remove('busy');
    }
  }

  function addButton() {
    const content = document.querySelector('#content');
    const table = content && content.querySelector('table.results');
    if (!table || content.querySelector('.satori-explain-button')) return;

    const bar = document.createElement('div');
    bar.className = 'buttton_bar';
    const button = document.createElement('a');
    button.className = 'satori-solve-btn satori-explain-button';
    button.textContent = '🔍 Explain bug';
    button.href = '#';
    button.addEventListener('click', (e) => { e.preventDefault(); explain(button, bar); });
    bar.appendChild(button);
    table.after(bar);
  }

  S.injectButtonStyle();
  addButton();
})();
