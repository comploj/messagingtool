// Single entry-point for calling any supported AI provider.
// Keeps provider-specific request shaping here so the SDR workflow runner
// doesn't have to care which provider a layer uses.

export const PROVIDER_KINDS = ['anthropic', 'openai_compatible'];

function pickText(data, provider) {
  if (provider.kind === 'anthropic') {
    if (Array.isArray(data?.content)) {
      return data.content
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
    }
    return '';
  }
  // openai_compatible
  const choice = data?.choices?.[0];
  return (choice?.message?.content ?? choice?.text ?? '').trim();
}

// Wraps fetch with an AbortController-driven timeout so a hung connection
// can never leave the UI in an indefinite "Responding…" state.
async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function callProvider({
  provider,
  apiKey,
  model,
  systemMessage = '',
  userPrompt,
  temperature = 0.6,
  maxTokens = 1500,
  timeoutMs = 90_000,
}) {
  if (!provider) throw new Error('No provider supplied');
  if (!apiKey) throw new Error(`Missing API key for provider: ${provider.name}`);
  if (!model) throw new Error(`Layer has no model set (provider: ${provider.name})`);

  if (provider.kind === 'anthropic') {
    const res = await fetchWithTimeout(provider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        ...(systemMessage ? { system: systemMessage } : {}),
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }, timeoutMs);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${provider.name} ${res.status}: ${body.slice(0, 500)}`);
    }
    return pickText(await res.json(), provider);
  }

  if (provider.kind === 'openai_compatible') {
    const messages = [];
    if (systemMessage) messages.push({ role: 'system', content: systemMessage });
    messages.push({ role: 'user', content: userPrompt });
    const res = await fetchWithTimeout(provider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
    }, timeoutMs);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${provider.name} ${res.status}: ${body.slice(0, 500)}`);
    }
    return pickText(await res.json(), provider);
  }

  throw new Error(`Unknown provider kind: ${provider.kind}`);
}

// Parse loosely: accept fenced JSON, surrounding prose, or raw JSON.
export function tryParseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  // strip markdown fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  // first {...} or [...] in the response
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) {
    try { return JSON.parse(obj[0]); } catch {}
  }
  const arr = trimmed.match(/\[[\s\S]*\]/);
  if (arr) {
    try { return JSON.parse(arr[0]); } catch {}
  }
  return null;
}
