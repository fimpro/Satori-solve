// Wspólne domyślne ustawienia (używane przez background.js, content.js i options.js).
const SETTINGS_DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'high', // 'off' = bez thinking, inaczej adaptive thinking z output_config.effort
  maxTokens: 64000, // łączny limit tokenów odpowiedzi (thinking + kod)
  maxAttempts: 5, // ile razy wysłać rozwiązanie, zanim się poddamy (status inny niż OK)
  parallel: 3, // Solve all: ile zadań rozwiązywać naraz
  resultTimeout: 600, // ile sekund czekać na wynik sprawdzania jednego submitu
  preview: true, // pokaż kod do akceptacji przed wysłaniem
  extraInstructions: '',
  // Ceny w USD za 1M tokenów, do szacowania kosztu. Sprawdź aktualne na anthropic.com/pricing.
  prices: {
    'claude-opus-5-5': { input: 5, output: 25 },
    'claude-sonnet-5-5': { input: 3, output: 15 },
    'claude-haiku-5-5': { input: 1, output: 5 },
  },
};
