(function () {
  const match = location.pathname.match(/^\/contest\/(\d+)\/problems\/(\d+)$/);
  if (!match) return;
  const [, contestId, problemId] = match;
  const S = SatoriSolver;

  const PANEL_CSS = `
    .card {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 420px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden;
      background: rgba(15, 23, 42, .97); color: #e2e8f0;
      border: 1px solid rgba(148, 163, 184, .18); border-radius: 18px;
      box-shadow: 0 24px 60px rgba(2, 6, 23, .55);
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      animation: pop .3s cubic-bezier(.2, .9, .3, 1.2);
    }
    @keyframes pop { from { opacity: 0; transform: translateY(16px) scale(.96); } }
    header {
      display: flex; align-items: center; gap: 10px; padding: 12px 16px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #ec4899); color: #fff;
    }
    .title { flex: 1; font-weight: 700; font-size: 14px; letter-spacing: .2px; }
    .badge { background: rgba(255, 255, 255, .22); border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
    .badge:empty { display: none; }
    .close { border: 0; background: transparent; color: #fff; font-size: 18px; line-height: 1; cursor: pointer; opacity: .8; }
    .close:hover { opacity: 1; }

    .scene { background: radial-gradient(ellipse at 50% 0%, #1e293b 0%, #0f172a 75%); padding: 6px 12px 0; }

    .status { display: flex; align-items: center; gap: 8px; padding: 10px 16px 6px; font-size: 15px; font-weight: 600; }
    .bar { height: 4px; margin: 0 16px; border-radius: 4px; background: rgba(148, 163, 184, .15); overflow: hidden; }
    .bar::after { content: ''; display: block; height: 100%; width: 100%; border-radius: 4px; background: #475569; }
    .busy .bar::after { width: 35%; background: linear-gradient(90deg, #6366f1, #ec4899); animation: slide 1.3s ease-in-out infinite; }
    .win .bar::after { background: #22c55e; }
    .lose .bar::after { background: #ef4444; }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(300%); } }

    .log { list-style: none; margin: 10px 0 0; padding: 0 16px 14px; max-height: 140px; overflow: auto; font-size: 12px; color: #94a3b8; }
    .log li { position: relative; padding: 2px 0 2px 14px; }
    .log li::before { content: ''; position: absolute; left: 2px; top: 9px; width: 5px; height: 5px; border-radius: 50%; background: #6366f1; }
    .log li.ok { color: #86efac; } .log li.ok::before { background: #22c55e; }
    .log li.err { color: #fca5a5; } .log li.err::before { background: #ef4444; }
    .log a { color: #a5b4fc; }

    .finish { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 10px; }
    .finish:empty { display: none; }
    .usage {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px;
      background: rgba(250, 204, 21, .08); border: 1px solid rgba(250, 204, 21, .25); color: #fde68a; font-size: 12px;
    }

    .review { display: none; flex-direction: column; gap: 8px; padding: 0 16px 16px; }
    .review.open { display: flex; }
    .review label { display: flex; align-items: center; gap: 8px; color: #94a3b8; }
    input, textarea {
      background: #020617; color: #e2e8f0; border: 1px solid #334155; border-radius: 10px; padding: 7px 9px;
      font: 12px/1.45 ui-monospace, Consolas, monospace; outline: none;
    }
    input:focus, textarea:focus { border-color: #8b5cf6; }
    input { flex: 1; }
    textarea { height: 34vh; resize: vertical; white-space: pre; tab-size: 4; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    button.primary, button.ghost { border-radius: 10px; padding: 7px 16px; font: 600 13px system-ui, sans-serif; cursor: pointer; }
    button.primary { border: 0; color: #fff; background: linear-gradient(135deg, #6366f1, #8b5cf6); }
    button.primary:hover { filter: brightness(1.1); }
    button.ghost { background: transparent; color: #cbd5e1; border: 1px solid #334155; }
  `;

  function createPanel() {
    document.getElementById('satori-solve-host')?.remove();
    const host = document.createElement('div');
    host.id = 'satori-solve-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${S.BASE_CSS}${PANEL_CSS}</style>
      <div class="card busy">
        <header>
          <span class="title">⚔️ Satori Solve</span>
          <span class="badge" data-role="attempt"></span>
          <button class="close" data-role="close" title="Zamknij">✕</button>
        </header>
        <div class="scene">${S.SCENE_SVG}</div>
        <div class="status" data-role="status">Przygotowuję się do walki...</div>
        <div class="bar"></div>
        <ul class="log" data-role="log"></ul>
        <div class="review" data-role="review">
          <label>Plik <input data-role="filename" spellcheck="false"></label>
          <textarea data-role="code" spellcheck="false"></textarea>
          <div class="actions">
            <button class="ghost" data-role="cancel">Anuluj</button>
            <button class="primary" data-role="send">Wyślij ⚔️</button>
          </div>
        </div>
        <div class="finish" data-role="finish"></div>
      </div>`;
    document.body.appendChild(host);

    const $ = (role) => root.querySelector(`[data-role="${role}"]`);
    const card = root.querySelector('.card');
    const logEl = $('log');
    let liveItem = null;
    let closed = false;
    $('close').addEventListener('click', () => { closed = true; host.remove(); });

    function addItem(html, kind) {
      const li = document.createElement('li');
      if (kind) li.className = kind;
      li.innerHTML = html;
      logEl.appendChild(li);
      logEl.scrollTop = logEl.scrollHeight;
      return li;
    }

    return {
      get closed() { return closed; },
      // 'busy' | 'win' | 'lose' | 'lose defeat' | 'idle'
      setState(state) { card.className = `card ${state}`; },
      status(text) { $('status').textContent = text; },
      attempt(n, max) { $('attempt').textContent = `Próba ${n}/${max}`; },
      log(text, kind) { liveItem = null; addItem(S.escapeHtml(text), kind); },
      // Nadpisuje ostatnią linię (postęp generowania / status submitu).
      live(text) {
        if (!liveItem) liveItem = addItem('', 'live');
        liveItem.textContent = text;
      },
      // Zamienia linię "live" na ostateczną (bez dublowania wpisu).
      settleLive(html, kind) {
        if (!liveItem) { addItem(html, kind); return; }
        liveItem.innerHTML = html;
        liveItem.className = kind || '';
        liveItem = null;
      },
      // Podsumowanie walki: zużycie tokenów i (opcjonalnie) duży przycisk do submitu.
      finish(usageText, href, label, kind) {
        $('finish').innerHTML = `<div class="usage">💰 ${S.escapeHtml(usageText)}</div>`
          + (href ? `<a class="cta ${kind}" href="${href}">${S.escapeHtml(label)}</a>` : '');
      },
      review(solution) {
        $('review').classList.add('open');
        $('filename').value = solution.filename;
        $('code').value = solution.code;
        return new Promise((resolve) => {
          const done = (value) => { $('review').classList.remove('open'); resolve(value); };
          $('send').onclick = () => done({ filename: $('filename').value.trim(), code: $('code').value });
          $('cancel').onclick = () => done(null);
        });
      },
    };
  }

  function getProblemCode() {
    const m = document.title.match(/Problem\s+([^:]+):/);
    return m ? m[1].trim() : null;
  }

  let running = false;

  async function solve(button) {
    if (running) return;
    running = true;
    button.style.opacity = '0.5';
    const ui = createPanel();
    try {
      ui.status('Czytam zwój z zadaniem...');
      const statement = S.statementFromDoc(document);
      const news = await S.getNews(contestId);
      ui.log(`Treść zadania i ${news.length} newsów wczytane.`);

      const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
      const result = await S.solveProblem({
        contestId, problemId, problemCode: getProblemCode(), statement, news, settings, ui,
        review: settings.preview ? ui.review : null,
        isCancelled: () => ui.closed,
      });

      const usageText = S.formatUsage(result.usage, result.cost);
      if (result.submitId) {
        ui.finish(usageText, `/contest/${contestId}/results/${result.submitId}`,
          `Zobacz submit ${result.submitId} (${result.status})`, result.status === 'OK' ? 'ok' : 'fail');
      } else {
        ui.finish(usageText);
      }
    } catch (e) {
      ui.setState('lose defeat');
      ui.status('Błąd');
      ui.log(e.message, 'err');
      if (e.usage) ui.finish(S.formatUsage(e.usage, e.cost));
      console.error('[satori-solve]', e);
    } finally {
      running = false;
      button.style.opacity = '';
    }
  }

  function addButton() {
    const bar = document.querySelector('.buttton_bar');
    if (!bar || bar.querySelector('.satori-solve-button')) return;

    const button = document.createElement('a');
    button.className = 'button satori-solve-button';
    button.textContent = 'Solve';
    button.href = '#';
    button.addEventListener('click', (e) => { e.preventDefault(); solve(button); });

    bar.appendChild(button);
  }

  addButton();

  // Gdy strona przebuduje pasek przycisków, dodaj przycisk ponownie.
  new MutationObserver(addButton).observe(document.body, { childList: true, subtree: true });
})();
