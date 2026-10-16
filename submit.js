(function () {
  const match = location.pathname.match(/^\/contest\/(\d+)\/submit\/?$/);
  if (!match) return;
  const [, contestId] = match;
  const S = SatoriSolver;

  const select = document.querySelector('#id_problem');
  const form = select && select.closest('form');
  if (!form) return;

  const CARD_CSS = `
    .card {
      margin: 24px 0; max-width: 900px; overflow: hidden; border-radius: 18px;
      background: #0f172a; color: #e2e8f0; border: 1px solid rgba(148, 163, 184, .18);
      box-shadow: 0 18px 44px rgba(2, 6, 23, .35); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    header {
      display: flex; align-items: center; gap: 12px; padding: 14px 20px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #ec4899); color: #fff;
    }
    .title { flex: 1; font-size: 18px; font-weight: 800; }
    .problem { background: rgba(255, 255, 255, .22); border-radius: 999px; padding: 3px 12px; font-weight: 600; }
    .body { padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 12px; }
    textarea, input {
      width: 100%; box-sizing: border-box; background: #020617; color: #e2e8f0; border: 1px solid #334155; border-radius: 12px;
      padding: 10px 12px; outline: none; transition: border-color .15s, box-shadow .15s;
    }
    textarea:focus, input:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, .25); }
    .prompt { min-height: 70px; resize: vertical; font: 14px/1.45 system-ui, sans-serif; }
    .code { min-height: 380px; resize: vertical; white-space: pre; tab-size: 4; font: 13px/1.5 ui-monospace, Consolas, monospace; }
    input { font: 13px ui-monospace, Consolas, monospace; }
    .row { display: flex; align-items: center; gap: 12px; }
    .row label { display: flex; align-items: center; gap: 8px; flex: 1; color: #94a3b8; }
    .status { color: #94a3b8; flex: 1; }
    .status.err { color: #fca5a5; }
    .status.ok { color: #86efac; }
    kbd { font: 11px ui-monospace, monospace; padding: 1px 5px; border-radius: 4px; border: 1px solid #475569; color: #94a3b8; }
    button { cursor: pointer; border: 0; color: #fff; font-family: system-ui, sans-serif; }
    button:disabled { opacity: .5; cursor: progress; }
    .vibe { border-radius: 12px; padding: 10px 20px; font-weight: 700; font-size: 14px; background: linear-gradient(135deg, #6366f1, #8b5cf6); }
    .vibe:not(:disabled):hover { filter: brightness(1.1); }
    .result[hidden] { display: none; }
    .result { display: flex; flex-direction: column; gap: 12px; }
    .submit-big {
      width: 100%; padding: 18px; border-radius: 14px; font-size: 20px; font-weight: 800; letter-spacing: .5px;
      background: linear-gradient(135deg, #16a34a, #22c55e 50%, #84cc16); box-shadow: 0 12px 30px rgba(34, 197, 94, .35);
      transition: transform .15s, filter .15s;
    }
    .submit-big:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.08); }
    .usage { color: #fde68a; font-size: 12px; }
    .usage:empty { display: none; }
    .spinner { display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -1px; border-radius: 50%;
      border: 2px solid rgba(148, 163, 184, .3); border-top-color: #a78bfa; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  const host = document.createElement('div');
  host.id = 'satori-vibe-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${S.BASE_CSS}${CARD_CSS}</style>
    <div class="card">
      <header>
        <span class="title">✨ Vibe this solution!</span>
        <span class="problem" data-role="problem"></span>
      </header>
      <div class="body">
        <textarea class="prompt" data-role="prompt" spellcheck="false"
          placeholder="Jak ma wyglądać kod? np. każdą zmienną nazywaj po średniowiecznemu"></textarea>
        <div class="row">
          <button class="vibe" data-role="vibe">✨ Vibe it</button>
          <span class="status" data-role="status"><kbd>Ctrl+Enter</kbd></span>
        </div>
        <div class="result" data-role="result" hidden>
          <div class="row"><label>Plik <input data-role="filename" spellcheck="false"></label></div>
          <textarea class="code" data-role="code" spellcheck="false"></textarea>
          <div class="usage" data-role="usage"></div>
          <button class="submit-big" data-role="submit">⚔️ SUBMIT</button>
        </div>
      </div>
    </div>`;
  form.after(host);

  const $ = (role) => root.querySelector(`[data-role="${role}"]`);
  let busy = false;

  function selected() {
    const opt = select.selectedOptions[0];
    if (!select.value || !opt) return null;
    // Opcja ma postać "B*: Cyklon" - kod zadania jest przed dwukropkiem.
    const [code, ...rest] = opt.textContent.split(':');
    return { id: select.value, code: code.trim(), title: rest.join(':').trim() };
  }

  function showProblem() {
    const p = selected();
    $('problem').textContent = p ? `${p.code}: ${p.title}` : 'wybierz zadanie';
  }

  function status(html, kind) {
    $('status').innerHTML = html;
    $('status').className = `status ${kind || ''}`;
  }

  function setBusy(value) {
    busy = value;
    $('vibe').disabled = value;
    $('submit').disabled = value;
  }

  async function vibe() {
    if (busy) return;
    const p = selected();
    if (!p) { status('Najpierw wybierz zadanie w formularzu powyżej.', 'err'); return; }
    setBusy(true);
    try {
      status('<span class="spinner"></span>Czytam treść zadania i newsy...');
      const [statement, news, settings] = await Promise.all([
        S.getStatement(contestId, p.id), S.getNews(contestId), chrome.storage.local.get(SETTINGS_DEFAULTS),
      ]);
      let prompt = S.buildPrompt(p.code, statement, news, settings.extraInstructions);
      const style = $('prompt').value.trim();
      if (style) {
        prompt += '\n\n# Style instructions from the user\n\n'
          + 'Follow these instructions for how the code is written (naming, comments, structure, style). '
          + `Keep the solution correct and efficient.\n\n${style}`;
      }

      const t0 = Date.now();
      const result = await S.generate(S.SYSTEM_PROMPT, [{ role: 'user', content: prompt }], (msg) => {
        if (msg.type === 'progress') {
          status(`<span class="spinner"></span>Vibing... ${Math.round((Date.now() - t0) / 1000)}s · kod ${msg.textChars} zn.`);
        }
      });
      const solution = S.parseSolution(result.text);
      if (!solution) throw new Error('Model nie zwrócił kodu w wymaganym formacie - spróbuj jeszcze raz.');

      $('filename').value = solution.filename;
      $('code').value = solution.code;
      $('result').hidden = false;
      const usage = S.addUsage(S.emptyUsage(), result.usage);
      $('usage').textContent = `💰 ${S.formatUsage(usage, S.costOf(usage, settings.model, settings.prices))}`;
      status(`Gotowe: ${S.escapeHtml(solution.filename)}. Możesz edytować kod przed wysłaniem.`, 'ok');
    } catch (e) {
      status(S.escapeHtml(e.message), 'err');
      console.error('[satori-vibe]', e);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy) return;
    const p = selected();
    const filename = $('filename').value.trim();
    const code = $('code').value;
    if (!p) { status('Najpierw wybierz zadanie w formularzu powyżej.', 'err'); return; }
    if (!filename || !code.trim()) { status('Brak nazwy pliku albo kodu.', 'err'); return; }
    setBusy(true);
    try {
      status(`<span class="spinner"></span>Wysyłam ${S.escapeHtml(filename)} do ${S.escapeHtml(p.code)}...`);
      const previousMaxId = (await S.getResults(contestId)).reduce((m, r) => Math.max(m, r.id), 0);
      const results = await S.submit(contestId, p.id, filename, code);
      // Od razu przechodzimy na stronę nowego submitu (Satori sam pokaże tam status sprawdzania).
      const mine = results.filter((r) => r.id > previousMaxId && r.problem === p.code).sort((a, b) => b.id - a.id)[0];
      status('Wysłano! Przechodzę do submitu...', 'ok');
      location.href = mine ? `/contest/${contestId}/results/${mine.id}` : `/contest/${contestId}/results`;
    } catch (e) {
      status(S.escapeHtml(e.message), 'err');
      console.error('[satori-vibe]', e);
    } finally {
      setBusy(false);
    }
  }

  $('vibe').addEventListener('click', vibe);
  $('submit').addEventListener('click', submit);
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); vibe(); }
  });
  // Tab w edytorze wstawia wcięcie zamiast przechodzić do następnego pola.
  $('code').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    e.target.setRangeText('    ', e.target.selectionStart, e.target.selectionEnd, 'end');
  });
  select.addEventListener('change', showProblem);
  showProblem();
})();
