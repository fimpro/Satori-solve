(function () {
  const match = location.pathname.match(/^\/contest\/(\d+)\/problems\/?$/);
  if (!match) return;
  const [, contestId] = match;
  const S = SatoriSolver;

  const OVERLAY_CSS = `
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
      background: rgba(2, 6, 23, .6); backdrop-filter: blur(3px); animation: fade .2s ease-out;
    }
    @keyframes fade { from { opacity: 0; } }
    .card {
      width: min(1180px, 95vw); max-height: 92vh; display: flex; flex-direction: column; overflow: hidden;
      background: #0f172a; color: #e2e8f0; border: 1px solid rgba(148, 163, 184, .18); border-radius: 20px;
      box-shadow: 0 30px 80px rgba(2, 6, 23, .6); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      animation: pop .3s cubic-bezier(.2, .9, .3, 1.2);
    }
    @keyframes pop { from { opacity: 0; transform: translateY(20px) scale(.97); } }
    header {
      display: flex; align-items: center; gap: 14px; padding: 14px 20px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #ec4899); color: #fff;
    }
    .title { font-weight: 800; font-size: 16px; }
    .counters { flex: 1; display: flex; gap: 8px; flex-wrap: wrap; }
    .chip { background: rgba(255, 255, 255, .2); border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
    .hbtn { border: 1px solid rgba(255, 255, 255, .5); background: rgba(255, 255, 255, .12); color: #fff; border-radius: 10px; padding: 5px 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
    .hbtn:hover { background: rgba(255, 255, 255, .25); }
    .hbtn[hidden] { display: none; }

    .progress { height: 4px; background: rgba(148, 163, 184, .15); }
    .progress > div { height: 100%; width: 0; background: linear-gradient(90deg, #22c55e, #84cc16); transition: width .4s; }

    .grid {
      flex: 1; overflow: auto; padding: 16px 20px; display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      grid-auto-rows: max-content; align-content: start;
    }
    .lane {
      background: #111c33; border: 1px solid rgba(148, 163, 184, .14); border-radius: 14px; overflow: hidden;
      display: flex; flex-direction: column; transition: border-color .3s, box-shadow .3s, opacity .3s;
    }
    .lane.busy { border-color: rgba(139, 92, 246, .6); box-shadow: 0 0 0 1px rgba(139, 92, 246, .25), 0 8px 24px rgba(139, 92, 246, .15); }
    .lane.win { border-color: rgba(34, 197, 94, .55); }
    .lane.lose { border-color: rgba(239, 68, 68, .55); }
    .lane.queued { opacity: .55; }
    .scene { background: radial-gradient(ellipse at 50% 0%, #1e293b 0%, #0f172a 80%); padding: 2px 6px 0; }
    .meta { padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 3px; }
    .row { display: flex; align-items: center; gap: 6px; }
    .code { font-weight: 800; color: #c4b5fd; }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cbd5e1; }
    .att { font-size: 11px; color: #94a3b8; }
    .st { font-size: 12px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .win .st { color: #86efac; } .lose .st { color: #fca5a5; }
    .lane a.mini { margin-top: 6px; text-align: center; text-decoration: none; font: 700 12px system-ui, sans-serif; color: #fff; border-radius: 9px; padding: 6px; }
    .win a.mini { background: linear-gradient(135deg, #16a34a, #22c55e); }
    .lose a.mini, .idle a.mini { background: linear-gradient(135deg, #b91c1c, #ef4444); }

    .lane .usage { font-size: 11px; color: #fde68a; opacity: .85; }
    .lane .usage:empty { display: none; }
    .chip.money { background: rgba(250, 204, 21, .25); }

    footer { padding: 14px 20px 18px; border-top: 1px solid rgba(148, 163, 184, .12); display: flex; flex-direction: column; gap: 10px; }
    footer:empty { display: none; }
    footer .total {
      text-align: center; padding: 8px 12px; border-radius: 10px; font-size: 13px;
      background: rgba(250, 204, 21, .08); border: 1px solid rgba(250, 204, 21, .25); color: #fde68a;
    }
  `;

  function getProblems() {
    return Array.from(document.querySelectorAll('#content table.results tr'))
      .map((tr) => {
        const link = tr.querySelector('a[href*="/problems/"]');
        const submit = tr.querySelector('a[href*="/submit?select="]');
        const idMatch = link && link.getAttribute('href').match(/\/problems\/(\d+)/);
        if (!idMatch || !submit) return null;
        return { id: idMatch[1], code: tr.querySelector('td').textContent.trim(), title: link.textContent.trim() };
      })
      .filter(Boolean);
  }

  function createOverlay(problems) {
    document.getElementById('satori-solve-all-host')?.remove();
    const host = document.createElement('div');
    host.id = 'satori-solve-all-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${S.BASE_CSS}${OVERLAY_CSS}</style>
      <div class="backdrop">
        <div class="card">
          <header>
            <span class="title">⚔️ Solve all</span>
            <div class="counters" data-role="counters"></div>
            <button class="hbtn" data-role="stop">Stop</button>
            <button class="hbtn" data-role="close" hidden>Zamknij</button>
          </header>
          <div class="progress"><div data-role="progress"></div></div>
          <div class="grid" data-role="grid"></div>
          <footer data-role="footer"></footer>
        </div>
      </div>`;
    document.body.appendChild(host);

    const $ = (role) => root.querySelector(`[data-role="${role}"]`);
    const lanes = new Map();

    problems.forEach((p, i) => {
      const lane = document.createElement('div');
      lane.className = 'lane queued';
      // Każda arena ma inne kolory i przesunięcie animacji.
      lane.innerHTML = `
        <div class="scene" style="${S.paletteStyle(i)};--delay:-${(i * 0.37) % 1.6}s">${S.SCENE_SVG}</div>
        <div class="meta">
          <div class="row"><span class="code">${S.escapeHtml(p.code)}</span><span class="name" title="${S.escapeHtml(p.title)}">${S.escapeHtml(p.title)}</span><span class="att"></span></div>
          <div class="st">Czeka na swoją kolej...</div>
          <div class="usage"></div>
        </div>`;
      $('grid').appendChild(lane);
      const q = (sel) => lane.querySelector(sel);
      lanes.set(p.id, {
        // 'queued' | 'busy' | 'idle' | 'win' | 'lose' | 'lose defeat'
        setState(state) { lane.className = `lane ${state}`; },
        status(text) { q('.st').textContent = text; q('.st').title = text; },
        attempt(n, max) { q('.att').textContent = `${n}/${max}`; },
        live(text) { this.status(text); },
        log(text, kind) { if (kind === 'err') this.status(text); },
        settleLive(html) { this.status(html.replace(/<[^>]+>/g, '')); },
        usage(text) { q('.usage').textContent = `💰 ${text}`; },
        link(href, label) {
          q('.meta').insertAdjacentHTML('beforeend', `<a class="mini" href="${href}" target="_blank">${S.escapeHtml(label)}</a>`);
        },
      });
    });

    return {
      root, lanes,
      onStop(fn) { $('stop').addEventListener('click', fn); },
      counters(c, cost) {
        $('counters').innerHTML = `<span class="chip">✅ ${c.ok}</span><span class="chip">⚔️ ${c.busy}</span>`
          + `<span class="chip">💀 ${c.fail}</span><span class="chip">⏳ ${c.queued}</span>`
          + (cost ? `<span class="chip money">💰 ≈ $${cost.toFixed(2)}</span>` : '');
        const total = c.ok + c.busy + c.fail + c.queued;
        $('progress').style.width = `${total ? ((c.ok + c.fail) / total) * 100 : 0}%`;
      },
      done(summary) {
        $('stop').hidden = true;
        $('close').hidden = false;
        $('close').onclick = () => host.remove();
        $('footer').innerHTML = `<div class="total">💰 Łącznie: ${S.escapeHtml(summary.usage)}</div>`
          + `<a class="cta ${summary.allOk ? 'ok' : ''}" href="/contest/${contestId}/results">${S.escapeHtml(summary.text)}</a>`;
      },
    };
  }

  let running = false;

  async function solveAll(button) {
    if (running) return;
    const problems = getProblems();
    const settings = await chrome.storage.local.get(SETTINGS_DEFAULTS);
    const parallel = Math.max(1, Number(settings.parallel) || 1);
    const maxAttempts = Math.max(1, Number(settings.maxAttempts) || 1);

    const msg = `Solve all: ${problems.length} zadań (także te, które mają już OK).\n`
      + `Do ${maxAttempts} prób na zadanie, ${parallel} naraz - łącznie do ${problems.length * maxAttempts} submitów.\n`
      + 'Kod będzie wysyłany bez podglądu.'
      + '\n\nKontynuować?';
    if (!confirm(msg)) return;

    running = true;
    button.classList.add('busy');
    let stopped = false;
    const ui = createOverlay(problems);
    const counts = { ok: 0, busy: 0, fail: 0, queued: problems.length };
    const totalUsage = S.emptyUsage();
    const totalCost = () => S.costOf(totalUsage, settings.model, settings.prices);
    const refresh = () => ui.counters(counts, totalCost());
    const usageText = S.formatUsage;
    refresh();

    const queue = [...problems];
    ui.onStop(() => {
      stopped = true;
      for (const p of queue) { const lane = ui.lanes.get(p.id); lane.setState('idle'); lane.status('Zatrzymano'); }
      counts.queued -= queue.length;
      queue.length = 0;
      refresh();
    });
    let news = [];
    try {
      news = await S.getNews(contestId);
    } catch (e) {
      console.error('[satori-solve]', e);
    }

    async function worker() {
      while (queue.length && !stopped) {
        const p = queue.shift();
        const lane = ui.lanes.get(p.id);
        counts.queued--; counts.busy++; refresh();
        let outcome = 'fail';
        let spent = null; // { usage, cost } z wyniku albo z wyjątku
        try {
          lane.setState('busy');
          lane.status('Czytam treść...');
          const statement = await S.getStatement(contestId, p.id);
          const result = await S.solveProblem({
            contestId, problemId: p.id, problemCode: p.code, statement, news, settings, ui: lane,
            review: null, isCancelled: () => stopped,
          });
          spent = result;
          if (result.status === 'OK') outcome = 'ok';
          else if (result.cancelled) outcome = 'cancelled';
          if (result.cancelled && !result.submitId) { lane.setState('idle'); lane.status('Zatrzymano'); }
          if (result.submitId) lane.link(`/contest/${contestId}/results/${result.submitId}`, `Zobacz submit (${result.status})`);
        } catch (e) {
          lane.setState('lose defeat');
          lane.status('Błąd: ' + e.message);
          if (e.usage) spent = e;
          console.error('[satori-solve]', p.code, e);
        }
        if (spent) {
          S.addUsage(totalUsage, spent.usage);
          lane.usage(usageText(spent.usage, spent.cost));
        }
        counts.busy--;
        if (outcome === 'ok') counts.ok++;
        else if (outcome === 'fail') counts.fail++;
        refresh();
      }
    }

    await Promise.all(Array.from({ length: Math.min(parallel, problems.length) }, worker));

    const okCount = counts.ok;
    ui.done({
      allOk: okCount === problems.length,
      usage: usageText(totalUsage, totalCost()),
      text: `${stopped ? 'Bitwa przerwana' : 'Koniec bitwy'}: ${okCount}/${problems.length} OK · Zobacz wyniki`,
    });
    running = false;
    button.classList.remove('busy');
  }

  function addButton() {
    const content = document.querySelector('#content');
    if (!content || content.querySelector('.satori-solve-all-button') || !getProblems().length) return;

    const bar = document.createElement('div');
    bar.className = 'buttton_bar';
    const button = document.createElement('a');
    button.className = 'satori-solve-btn satori-solve-all-button';
    button.textContent = '⚔️ Solve all';
    button.href = '#';
    button.addEventListener('click', (e) => { e.preventDefault(); solveAll(button); });
    bar.appendChild(button);
    content.prepend(bar);
  }

  S.injectButtonStyle();
  addButton();
})();
