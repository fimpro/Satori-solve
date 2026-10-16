// Proste pola mają w HTML element o id równym kluczowi; ceny mają własną tabelkę.
const FIELDS = Object.keys(SETTINGS_DEFAULTS).filter((k) => k !== 'prices');
const MODELS = Object.keys(SETTINGS_DEFAULTS.prices);
const $ = (id) => document.getElementById(id);

function read(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return Number(el.value);
  return el.value;
}

function write(el, value) {
  if (el.type === 'checkbox') el.checked = value;
  else el.value = value;
}

// Rycerz i smok w nagłówku (grafika z solver.js).
const style = document.createElement('style');
style.textContent = SatoriSolver.BASE_CSS;
document.head.appendChild(style);
$('hero-scene').innerHTML = SatoriSolver.SCENE_SVG;

const priceTable = $('prices');
for (const model of MODELS) {
  priceTable.insertAdjacentHTML('beforeend', `<tr><td>${model}</td>`
    + `<td><input type="number" min="0" step="0.01" id="price-${model}-input"></td>`
    + `<td><input type="number" min="0" step="0.01" id="price-${model}-output"></td></tr>`);
}
const priceInput = (model, kind) => $(`price-${model}-${kind}`);

function setStatus(text, kind) {
  $('status').textContent = text;
  $('status').className = kind || '';
}

chrome.storage.local.get(SETTINGS_DEFAULTS).then((s) => {
  for (const key of FIELDS) write($(key), s[key]);
  for (const model of MODELS) {
    const p = s.prices[model] || SETTINGS_DEFAULTS.prices[model];
    priceInput(model, 'input').value = p.input;
    priceInput(model, 'output').value = p.output;
  }
});

document.addEventListener('input', () => setStatus('Niezapisane zmiany', 'dirty'));

$('toggleKey').addEventListener('click', () => {
  const visible = $('apiKey').type === 'text';
  $('apiKey').type = visible ? 'password' : 'text';
  $('toggleKey').textContent = visible ? 'Pokaż' : 'Ukryj';
});

async function save() {
  const s = {};
  for (const key of FIELDS) s[key] = read($(key));
  s.apiKey = s.apiKey.trim();
  s.prices = {};
  for (const model of MODELS) {
    s.prices[model] = { input: Number(priceInput(model, 'input').value), output: Number(priceInput(model, 'output').value) };
  }
  await chrome.storage.local.set(s);
  setStatus('✓ Zapisano', 'saved');
}

$('save').addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});
