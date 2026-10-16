importScripts('settings.js');

const API_URL = 'https://api.anthropic.com/v1/messages';

// Content script łączy się portem; klucz API nigdy nie opuszcza service workera.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'satori-solve') return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'generate') return; // np. 'ping' tylko podtrzymuje service worker
    try {
      const result = await generate(msg.system, msg.messages, port, controller.signal);
      port.postMessage({ type: 'done', ...result });
    } catch (e) {
      if (!controller.signal.aborted) port.postMessage({ type: 'error', message: String(e.message || e) });
    }
  });
});

async function generate(system, messages, port, signal) {
  const s = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  if (!s.apiKey) throw new Error('Brak klucza API - ustaw go w opcjach rozszerzenia.');

  const body = {
    model: s.model,
    max_tokens: Number(s.maxTokens) || SETTINGS_DEFAULTS.maxTokens,
    stream: true,
    system,
    messages,
  };
  if (s.effort !== 'off') {
    body.thinking = { type: 'adaptive' };
    body.output_config = { effort: s.effort };
  }

  port.postMessage({ type: 'start', model: s.model });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': s.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try { message = JSON.parse(raw).error.message; } catch (_) {}
    throw new Error(`API ${res.status}: ${message}`);
  }

  // Parsowanie strumienia SSE.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let thinkingChars = 0;
  let stopReason = null;
  let lastProgress = 0;
  // Zużycie tokenów: message_start podaje input, message_delta narastająco output (z thinking).
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const readUsage = (u) => {
    if (!u) return;
    if (u.input_tokens != null) usage.input = u.input_tokens;
    if (u.output_tokens != null) usage.output = u.output_tokens;
    if (u.cache_read_input_tokens != null) usage.cacheRead = u.cache_read_input_tokens;
    if (u.cache_creation_input_tokens != null) usage.cacheWrite = u.cache_creation_input_tokens;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = event.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const data = JSON.parse(dataLine.slice(5));

      if (data.type === 'message_start') {
        readUsage(data.message.usage);
      } else if (data.type === 'content_block_delta') {
        if (data.delta.type === 'text_delta') text += data.delta.text;
        else if (data.delta.type === 'thinking_delta') thinkingChars += data.delta.thinking.length;
      } else if (data.type === 'message_delta') {
        stopReason = data.delta.stop_reason;
        readUsage(data.usage);
      } else if (data.type === 'error') {
        throw new Error(`API: ${data.error.message}`);
      }
    }

    const now = Date.now();
    if (now - lastProgress > 500) {
      lastProgress = now;
      port.postMessage({ type: 'progress', thinkingChars, textChars: text.length, text });
    }
  }

  return { text, stopReason, usage };
}
