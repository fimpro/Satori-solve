// Wspólna logika: odczyt treści, model, submit, wyniki oraz grafika rycerza i smoka.
// Ładowany przed content.js (strona zadania) i contest.js (lista zadań).
const SatoriSolver = (() => {
  // Statusy oznaczające, że submit wciąż czeka na sprawdzenie.
  const PENDING_STATUSES = ['', 'QUE'];
  const POLL_INTERVAL_MS = 3000;

  const SYSTEM_PROMPT = `You are an expert competitive programmer solving a task on Satori, the online judge of Jagiellonian University (TCS UJ).

You will get the problem statement and the contest news. Read the news carefully: they often contain rules that override defaults (allowed languages, compiler versions, required file names, I/O conventions, forbidden libraries, limits).

Choose the programming language yourself, respecting any constraints from the statement and news. If nothing constrains it, prefer C++17. Satori picks the compiler by file extension (.cpp, .c, .py, .java, ...). For Java the public class name must match the file name.

Read input from standard input and write output to standard output exactly as specified; never print prompts or debug output. Make the solution efficient enough for the stated limits and handle edge cases.

Always use fast I/O (e.g. in C++: std::ios::sync_with_stdio(false); std::cin.tie(nullptr); avoid std::endl; in Python: sys.stdin.buffer / sys.stdout.write).

If a submission fails, you will get the judge status and checking report. Find the bug, fix it and send the complete corrected solution. Hints for reading the report:
- Test 0 is usually the sample test from the statement (but this is not a strict rule). Failing it usually means a basic bug or a wrong I/O format.
- The last tests are usually the large ones (big data sets). Failing only those usually means the solution is too slow, uses too much memory, or overflows.

Reply with exactly this format and nothing else:
<filename>NAME.EXT</filename>
\`\`\`LANG
full source code
\`\`\``;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  // ---------- Odczyt treści ----------

  // Zamienia HTML na czytelny tekst; MathJax zastępuje oryginalnym TeX-em.
  function htmlToText(root) {
    const el = root.cloneNode(true);
    el.querySelectorAll('script[type^="math/tex"]').forEach((s) => {
      const tex = s.textContent;
      s.replaceWith(s.type.includes('mode=display') ? `$$${tex}$$` : `$${tex}$`);
    });
    el.querySelectorAll('.MathJax, .MathJax_Preview, .MathJax_Display, .headerlink, .button, script, style').forEach((n) => n.remove());

    const BLOCK = ['p', 'div', 'tr', 'table', 'ul', 'ol', 'section', 'dl', 'dt', 'dd', 'blockquote'];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, ' ');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase();
      if (tag === 'pre') return '\n```\n' + node.textContent.replace(/\n$/, '') + '\n```\n';
      if (tag === 'br') return '\n';
      const inner = Array.from(node.childNodes).map(walk).join('');
      if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(+tag[1])} ${inner.trim()}\n\n`;
      if (tag === 'li') return `\n- ${inner.trim()}`;
      if (tag === 'td' || tag === 'th') return inner.trim() + ' | ';
      if (BLOCK.includes(tag)) return `\n${inner}\n`;
      return inner;
    }

    return walk(el).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function fetchDoc(url, init) {
    const res = await fetch(url, { credentials: 'same-origin', ...init });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    return { doc, url: res.url };
  }

  function statementFromDoc(doc) {
    const root = doc.querySelector('.mainsphinx') || doc.querySelector('#content');
    return root ? htmlToText(root) : '';
  }

  async function getStatement(contestId, problemId) {
    const { doc } = await fetchDoc(`/contest/${contestId}/problems/${problemId}`);
    return statementFromDoc(doc);
  }

  async function getNews(contestId) {
    const { doc } = await fetchDoc(`/contest/${contestId}/news`);
    return Array.from(doc.querySelectorAll('.newsmsg')).map(htmlToText);
  }

  function buildPrompt(problemCode, statement, news, extraInstructions) {
    let prompt = `# Problem ${problemCode || ''}\n\n${statement}\n\n# Contest news (${news.length})\n\n`
      + (news.length ? news.map((n, i) => `## News ${i + 1}\n${n}`).join('\n\n') : '(none)');
    if (extraInstructions && extraInstructions.trim()) prompt += `\n\n# Additional instructions\n\n${extraInstructions.trim()}`;
    return prompt;
  }

  // ---------- Model ----------

  function generate(system, messages, onEvent) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'satori-solve' });
      // Ping podtrzymuje service worker przy długim generowaniu.
      const ping = setInterval(() => port.postMessage({ type: 'ping' }), 20000);
      const finish = (fn, value) => { clearInterval(ping); port.disconnect(); fn(value); };

      port.onMessage.addListener((msg) => {
        if (msg.type === 'done') finish(resolve, msg);
        else if (msg.type === 'error') finish(reject, new Error(msg.message));
        else onEvent(msg);
      });
      port.onDisconnect.addListener(() => { clearInterval(ping); reject(new Error('Połączenie z rozszerzeniem przerwane.')); });
      port.postMessage({ type: 'generate', system, messages });
    });
  }

  const EXT_BY_LANG = { cpp: 'cpp', 'c++': 'cpp', c: 'c', python: 'py', py: 'py', java: 'java', pascal: 'pas', rust: 'rs', go: 'go' };

  function parseSolution(text) {
    const code = text.match(/```([\w+#-]*)[^\n]*\n([\s\S]*?)```/);
    if (!code) return null;
    let filename = (text.match(/<filename>\s*([^<\s]+)\s*<\/filename>/) || [])[1];
    if (!filename) filename = `solution.${EXT_BY_LANG[code[1].toLowerCase()] || 'cpp'}`;
    return { filename, code: code[2] };
  }

  // ---------- Satori: submit i wyniki ----------

  function parseResults(doc) {
    const table = doc.querySelector('table.results');
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent.trim());
    const problemCol = headers.indexOf('Problem');
    return Array.from(table.querySelectorAll('tr')).slice(1).map((tr) => {
      const cells = tr.querySelectorAll('td');
      const link = tr.querySelector('a.stdlink');
      const status = tr.querySelector('.submitstatus > div');
      return {
        id: link ? Number(link.textContent.trim()) : 0,
        problem: problemCol >= 0 && cells[problemCol] ? cells[problemCol].textContent.trim() : null,
        status: status ? status.textContent.trim() : '',
      };
    }).filter((r) => r.id);
  }

  // Satori domyślnie pokazuje 30 ostatnich submitów - wystarcza do śledzenia nowych.
  async function getResults(contestId) {
    const { doc } = await fetchDoc(`/contest/${contestId}/results`);
    return parseResults(doc);
  }

  // Raport sprawdzarki (tabela testów / błędy kompilacji) ze strony szczegółów submitu.
  async function getReport(contestId, submitId) {
    const { doc } = await fetchDoc(`/contest/${contestId}/results/${submitId}`);
    const heading = Array.from(doc.querySelectorAll('h4')).find((h) => /checking report/i.test(h.textContent));
    let el = heading && heading.nextElementSibling;
    const parts = [];
    while (el && !el.matches('hr')) { parts.push(htmlToText(el)); el = el.nextElementSibling; }
    return parts.join('\n').trim() || '(no report)';
  }

  async function submit(contestId, problemId, filename, code) {
    const form = new FormData();
    form.append('problem', problemId);
    form.append('codefile', new File([code], filename, { type: 'text/plain' }));
    const { doc, url } = await fetchDoc(`/contest/${contestId}/submit`, { method: 'POST', body: form });
    // Po udanym submicie Satori przekierowuje na /results.
    if (!/\/results/.test(url)) {
      const errors = doc.querySelector('.errorlist');
      throw new Error('Submit odrzucony' + (errors ? ': ' + errors.textContent.trim() : '.'));
    }
  }

  async function waitForResult(contestId, previousMaxId, problemCode, onTick, timeoutSec) {
    const seconds = Number(timeoutSec) || SETTINGS_DEFAULTS.resultTimeout;
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      const mine = (await api.getResults(contestId))
        .filter((r) => r.id > previousMaxId && (!problemCode || r.problem === problemCode))
        .sort((a, b) => b.id - a.id)[0];
      if (mine) {
        onTick(mine);
        if (!PENDING_STATUSES.includes(mine.status)) return mine;
      }
      if (Date.now() > deadline) throw new Error(`Brak wyniku po ${seconds}s - zwiększ "Czas oczekiwania na wynik" w opcjach.`);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // ---------- Tokeny i koszt ----------

  const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

  function addUsage(total, u) {
    if (!u) return total;
    for (const k of Object.keys(total)) total[k] += u[k] || 0;
    return total;
  }

  // Szacunkowy koszt w USD według cen z ustawień (cache: zapis 1.25x, odczyt 0.1x ceny wejścia).
  function costOf(usage, model, prices) {
    const p = (prices || {})[model];
    if (!p) return null;
    const input = usage.input + usage.cacheWrite * 1.25 + usage.cacheRead * 0.1;
    return (input * p.input + usage.output * p.output) / 1e6;
  }

  const fmtNum = (n) => n.toLocaleString('pl-PL');

  function formatUsage(usage, cost) {
    const input = usage.input + usage.cacheRead + usage.cacheWrite;
    const tokens = `${fmtNum(input + usage.output)} tok. (in ${fmtNum(input)} / out ${fmtNum(usage.output)})`;
    return cost == null ? `${tokens} · brak ceny dla modelu` : `${tokens} · ≈ $${cost.toFixed(cost < 1 ? 3 : 2)}`;
  }

  // ---------- Pętla rozwiązywania jednego zadania ----------

  // ui: { setState, status, attempt, log, live, settleLive } - wszystkie opcjonalne.
  // review(solution) -> Promise<solution|null>; brak = wysyłka bez podglądu.
  // Zwraca { status, submitId, usage, cost } albo { cancelled: true, usage, cost }.
  // Przy wyjątku zużycie jest w error.usage / error.cost.
  async function solveProblem(args) {
    const usage = emptyUsage();
    const withCost = (obj) => Object.assign(obj, { usage, cost: costOf(usage, args.settings.model, args.settings.prices) });
    try {
      return withCost(await runAttempts(args, usage));
    } catch (e) {
      throw withCost(e);
    }
  }

  async function runAttempts({ contestId, problemId, problemCode, statement, news, settings, ui, review, isCancelled }, usage) {
    const u = { setState() {}, status() {}, attempt() {}, log() {}, live() {}, settleLive() {}, ...ui };
    const cancelled = () => (isCancelled ? isCancelled() : false);
    const maxAttempts = Math.max(1, Number(settings.maxAttempts) || 1);
    const messages = [{ role: 'user', content: buildPrompt(problemCode, statement, news, settings.extraInstructions) }];
    let last = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (cancelled()) return { cancelled: true, ...last };
      u.attempt(attempt, maxAttempts);
      u.setState('busy');

      // 1. Generowanie kodu.
      u.status('Model kuje rozwiązanie...');
      const t0 = Date.now();
      const result = await api.generate(SYSTEM_PROMPT, messages, (msg) => {
        if (msg.type === 'start') u.log(`Model: ${msg.model}`);
        if (msg.type === 'progress') {
          u.live(`${Math.round((Date.now() - t0) / 1000)}s · thinking ${msg.thinkingChars} zn. · kod ${msg.textChars} zn.`);
        }
      });
      addUsage(usage, result.usage);
      messages.push({ role: 'assistant', content: result.text });
      if (result.stopReason === 'max_tokens') u.log('Odpowiedź ucięta przez limit tokenów.', 'err');

      let solution = parseSolution(result.text);
      if (!solution) {
        u.log('Model nie zwrócił kodu w wymaganym formacie.', 'err');
        messages.push({ role: 'user', content: 'Your reply did not contain the solution in the required format. Reply again with <filename> and one fenced code block.' });
        continue;
      }
      u.log(`Gotowe: ${solution.filename} (${solution.code.split('\n').length} linii).`);

      // 2. Opcjonalny podgląd.
      if (review) {
        u.setState('idle');
        u.status('Sprawdź kod przed bitwą');
        solution = await review(solution);
        if (!solution) { u.status('Odwrót.'); u.log('Anulowano.'); return { cancelled: true, ...last }; }
        u.setState('busy');
      }
      if (cancelled()) return { cancelled: true, ...last };

      // 3. Submit i oczekiwanie na wynik.
      u.status(`Wysyłam ${solution.filename}...`);
      const previousMaxId = (await api.getResults(contestId)).reduce((m, r) => Math.max(m, r.id), 0);
      await api.submit(contestId, problemId, solution.filename, solution.code);

      u.status('Rycerz walczy ze smokiem...');
      const final = await api.waitForResult(contestId, previousMaxId, problemCode,
        (r) => u.live(`Submit ${r.id}: ${r.status || 'w kolejce'}`), settings.resultTimeout);
      last = { status: final.status, submitId: final.id };
      const link = `/contest/${contestId}/results/${final.id}`;

      if (final.status === 'OK') {
        u.setState('win');
        u.status('🎉 OK! Smok pokonany!');
        u.settleLive(`Submit <a href="${link}" target="_blank">${final.id}</a>: OK`, 'ok');
        return last;
      }

      u.setState('lose');
      u.settleLive(`Submit <a href="${link}" target="_blank">${final.id}</a>: ${escapeHtml(final.status)}`, 'err');
      if (attempt === maxAttempts) break;
      u.status(`Trafienie: ${final.status}. Szykuję kolejny atak...`);
      const report = await api.getReport(contestId, final.id);
      messages.push({
        role: 'user',
        content: `Your submission ${solution.filename} got status ${final.status}.\n\nChecking report:\n${report}\n\n`
          + 'Common statuses: ANS = wrong answer, TLE = time limit exceeded, MEM = memory limit exceeded, RTE = runtime error (including OOM by dynamic alocation), CME = compilation error.\n'
          + 'Fix the solution and reply in the same format.',
      });
      await sleep(1200);
    }

    u.setState('lose defeat');
    u.status(`💀 Smok wygrał${last ? ` (${last.status})` : ''} - koniec prób.`);
    return last || { status: 'ERR' };
  }

  // ---------- Grafika ----------

  const BASE_CSS = `
    :host { all: initial; }
    svg { display: block; width: 100%; height: auto; }
    svg * { transform-box: fill-box; }
    a.cta {
      display: block; text-align: center; text-decoration: none; color: #fff; font: 700 15px system-ui, sans-serif;
      padding: 12px 16px; border-radius: 12px; background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #ec4899);
      box-shadow: 0 8px 24px rgba(139, 92, 246, .35); transition: transform .15s, filter .15s;
    }
    a.cta:hover { transform: translateY(-1px); filter: brightness(1.1); }
    a.cta.ok { background: linear-gradient(135deg, #16a34a, #22c55e); box-shadow: 0 8px 24px rgba(34, 197, 94, .35); }
    a.cta.fail { background: linear-gradient(135deg, #b91c1c, #ef4444); box-shadow: 0 8px 24px rgba(239, 68, 68, .3); }

    /* --- rycerz kontra smok --- */
    .star { animation: twinkle 2.4s ease-in-out infinite; }
    .star:nth-child(2) { animation-delay: .8s; } .star:nth-child(3) { animation-delay: 1.6s; } .star:nth-child(4) { animation-delay: 1.2s; }
    @keyframes twinkle { 50% { opacity: .2; } }

    .knight { transform-origin: 30% 100%; }
    .sword { transform-origin: 0% 100%; }
    .wing { transform-origin: 0% 100%; }
    .dragon { transform-origin: 50% 100%; }
    .flame { opacity: 0; transform-origin: 100% 50%; }
    .trophy { opacity: 0; transform-origin: 50% 50%; }

    .busy .knight { animation: charge 1.6s ease-in-out infinite; }
    .busy .sword { animation: swing .4s ease-in-out infinite alternate; }
    .busy .dragon { animation: hover 1.6s ease-in-out infinite; }
    .busy .wing { animation: flap .45s ease-in-out infinite alternate; }
    .busy .flame { animation: fire 1.6s ease-in infinite; }
    /* --delay rozsynchronizowuje wiele scen naraz (Solve all). */
    .busy .knight, .busy .sword, .busy .dragon, .busy .wing, .busy .flame { animation-delay: var(--delay, 0s); }
    .busy .flame.f2 { animation-delay: calc(var(--delay, 0s) + .08s); }
    .busy .flame.f3 { animation-delay: calc(var(--delay, 0s) + .16s); }
    @keyframes charge { 0%, 100% { transform: translateX(0); } 45% { transform: translateX(-8px); } 70% { transform: translateX(22px); } }
    @keyframes swing { from { transform: rotate(-30deg); } to { transform: rotate(40deg); } }
    @keyframes hover { 50% { transform: translateY(-6px); } }
    @keyframes flap { from { transform: rotate(-12deg); } to { transform: rotate(20deg); } }
    @keyframes fire { 0%, 15% { opacity: 0; transform: scale(.2); } 30% { opacity: 1; transform: scale(1); } 45% { opacity: .9; transform: scale(1.15); } 60%, 100% { opacity: 0; transform: scale(.5); } }

    .win .dragon { animation: fall .9s ease-in forwards; }
    .win .knight { animation: jump .5s ease-out 4; }
    .win .sword { transform: rotate(-20deg); }
    .win .trophy { animation: popin .5s .7s cubic-bezier(.2, .9, .3, 1.5) forwards; }
    @keyframes fall { to { transform: translateY(10px) rotate(75deg); opacity: .3; } }
    @keyframes jump { 50% { transform: translateY(-16px); } }
    @keyframes popin { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: scale(1); } }

    .lose .knight { animation: knockback .6s ease-out; }
    .lose .flame { animation: fire .9s ease-in 2; }
    .lose .dragon { animation: hover .6s ease-in-out 2; }
    @keyframes knockback { 30% { transform: translateX(-14px) rotate(-8deg); } 60% { transform: translateX(4px); } }

    .defeat .knight { animation: faint .8s .4s ease-in forwards; }
    .defeat .flame { animation: fire 1.2s ease-in infinite; }
    .defeat .dragon { animation: hover 1.2s ease-in-out infinite; }
    @keyframes faint { to { transform: translate(30px, 2px) rotate(-82deg); opacity: .75; } }
  `;

  const SCENE_SVG = `
    <svg viewBox="0 0 320 132" aria-hidden="true">
      <g fill="#cbd5e1">
        <circle class="star" cx="22" cy="18" r="1.5"/><circle class="star" cx="118" cy="12" r="1.2"/>
        <circle class="star" cx="300" cy="22" r="1.5"/><circle class="star" cx="205" cy="8" r="1.2"/>
      </g>
      <path d="M0 121 H320" stroke="#334155" stroke-width="2"/>
      <g fill="#1e3a2f"><ellipse cx="30" cy="122" rx="14" ry="3"/><ellipse cx="160" cy="122" rx="20" ry="3"/><ellipse cx="300" cy="122" rx="12" ry="3"/></g>

      <g class="knight">
        <rect x="58" y="104" width="9" height="17" rx="3" fill="#94a3b8"/>
        <rect x="73" y="104" width="9" height="17" rx="3" fill="#94a3b8"/>
        <rect x="54" y="72" width="32" height="35" rx="10" fill="#cbd5e1" stroke="#64748b" stroke-width="2"/>
        <rect x="62" y="76" width="16" height="28" rx="4" fill="var(--tabard, #6366f1)"/>
        <path d="M70 82 l3 6 h-6 z" fill="#fde047"/>
        <path d="M66 45 q-8 -18 -24 -9 q13 1 15 14 z" fill="var(--plume, #ef4444)"/>
        <circle cx="70" cy="58" r="15" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/>
        <rect x="70" y="54" width="14" height="4" rx="2" fill="#334155"/>
        <path d="M44 80 h18 v14 q0 11 -9 15 q-9 -4 -9 -15 z" fill="#f59e0b" stroke="#b45309" stroke-width="2"/>
        <path d="M53 85 v18 M46 92 h14" stroke="#b45309" stroke-width="2"/>
        <g class="sword">
          <path d="M87 89 L113 55" stroke="#e5e7eb" stroke-width="4" stroke-linecap="round"/>
          <path d="M81 84 L93 94" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
          <circle cx="85" cy="92" r="2.5" fill="#f59e0b"/>
        </g>
        <circle cx="87" cy="89" r="4.5" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
      </g>

      <g class="flames">
        <ellipse class="flame f3" cx="140" cy="84" rx="13" ry="9" fill="#f97316"/>
        <ellipse class="flame f2" cx="158" cy="84" rx="10" ry="7" fill="#fb923c"/>
        <ellipse class="flame f1" cx="175" cy="84" rx="7" ry="5" fill="#fde047"/>
      </g>

      <g class="dragon">
        <path d="M272 104 q38 4 36 -26 q-6 12 -22 14 z" fill="var(--dragon-dark, #16a34a)"/>
        <path d="M304 74 l8 -4 l-3 9 z" fill="#fde047"/>
        <path class="wing" d="M252 88 L284 42 L281 64 L302 56 L278 92 Z" fill="var(--dragon-wing, #15803d)" stroke="#14532d" stroke-width="1.5"/>
        <ellipse cx="250" cy="99" rx="32" ry="20" fill="var(--dragon, #22c55e)"/>
        <ellipse cx="242" cy="105" rx="18" ry="10" fill="var(--dragon-belly, #bbf7d0)"/>
        <path d="M244 80 l5 -9 l4 8 M256 81 l5 -8 l3 9 M268 86 l6 -7 l2 9" fill="#fde047"/>
        <rect x="232" y="110" width="10" height="11" rx="3" fill="var(--dragon-dark, #16a34a)"/>
        <rect x="257" y="110" width="10" height="11" rx="3" fill="var(--dragon-dark, #16a34a)"/>
        <path d="M226 92 q-6 -10 -12 -14" stroke="var(--dragon, #22c55e)" stroke-width="12" stroke-linecap="round" fill="none"/>
        <path d="M214 61 l3 -12 l5 12 z M223 63 l6 -10 l2 12 z" fill="#fde047"/>
        <circle cx="214" cy="74" r="15" fill="var(--dragon, #22c55e)"/>
        <ellipse cx="199" cy="81" rx="12" ry="8" fill="var(--dragon, #22c55e)"/>
        <circle cx="191" cy="78" r="1.5" fill="#14532d"/>
        <path d="M190 86 q8 3 16 0" stroke="#14532d" stroke-width="1.5" fill="none"/>
        <circle cx="213" cy="69" r="4.5" fill="#fff"/>
        <circle cx="211.5" cy="69" r="2.2" fill="#0f172a"/>
        <circle cx="222" cy="78" r="3" fill="#f9a8d4" opacity=".7"/>
      </g>

      <text class="trophy" x="160" y="44" text-anchor="middle" font-size="28">🏆</text>
    </svg>`;

  // Warianty kolorów dla wielu walk naraz.
  const PALETTES = [
    {},
    { '--tabard': '#ef4444', '--plume': '#3b82f6', '--dragon': '#a855f7', '--dragon-dark': '#7e22ce', '--dragon-wing': '#6b21a8', '--dragon-belly': '#f3e8ff' },
    { '--tabard': '#10b981', '--plume': '#f59e0b', '--dragon': '#ef4444', '--dragon-dark': '#b91c1c', '--dragon-wing': '#991b1b', '--dragon-belly': '#fecaca' },
    { '--tabard': '#f59e0b', '--plume': '#8b5cf6', '--dragon': '#06b6d4', '--dragon-dark': '#0e7490', '--dragon-wing': '#155e75', '--dragon-belly': '#cffafe' },
    { '--tabard': '#ec4899', '--plume': '#22c55e', '--dragon': '#f97316', '--dragon-dark': '#c2410c', '--dragon-wing': '#9a3412', '--dragon-belly': '#ffedd5' },
  ];

  function paletteStyle(i) {
    return Object.entries(PALETTES[i % PALETTES.length]).map(([k, v]) => `${k}:${v}`).join(';');
  }

  const api = {
    SYSTEM_PROMPT, BASE_CSS, SCENE_SVG,
    sleep, escapeHtml, htmlToText, fetchDoc, statementFromDoc, getStatement, getNews, buildPrompt,
    generate, parseSolution, getResults, getReport, submit, waitForResult, solveProblem, paletteStyle,
    emptyUsage, addUsage, costOf, formatUsage,
  };
  return api;
})();
