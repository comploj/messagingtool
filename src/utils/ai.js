import { callShareAi } from './apiClient';
import { getEffectivePrelude, getEffectivePostlude } from './promptOverrides';
import { getDefaultMessageModel, getAiProvider, getApiKey } from './storage';
import { callProvider } from './aiProviders';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

const CORS_PROXIES = [
  { url: (u) => `/api/scrape?url=${encodeURIComponent(u)}`, format: 'json' },
  { url: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`, format: 'raw' },
  { url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, format: 'json' },
];

// Auth context for AI calls — either the user's own key (logged-in flow,
// direct browser → Anthropic) or a share token (browser → server proxy
// using the owner's stored key). All helpers in this file thread `ctx`
// through unchanged so call sites only think about it once. A bare string
// is also accepted for backwards compatibility with older callers that
// pass an Anthropic key directly.
async function dispatchAnthropic(ctx, body) {
  const normalized = typeof ctx === 'string' ? { apiKey: ctx } : (ctx || {});
  if (normalized.shareToken) {
    return callShareAi(normalized.shareToken, body);
  }
  const apiKey = normalized.apiKey ?? '';
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

export async function callClaude(prompt, ctx, maxTokens = 1024) {
  const data = await dispatchAnthropic(ctx, {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return data.content[0].text;
}

export async function callClaudeWithWebSearch(prompt, ctx, maxTokens = 2048, maxUses = 3) {
  const data = await dispatchAnthropic(ctx, {
    model: MODEL,
    max_tokens: maxTokens,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
    messages: [{ role: 'user', content: prompt }],
  });
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

function normalizeUrl(url) {
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'https://' + u;
  }
  return u;
}

export async function scrapeWebsite(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const errors = [];
  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetch(proxy.url(url));
      if (!res.ok) {
        errors.push(`${res.status}`);
        continue;
      }
      let html;
      if (proxy.format === 'json') {
        const data = await res.json();
        html = data.contents || '';
      } else {
        html = await res.text();
      }
      const text = stripHtml(html);
      if (text.length < 50) {
        errors.push('empty response');
        continue;
      }
      // Detect blocked / error / bot protection pages
      const lower = text.toLowerCase();
      const isBlocked =
        (lower.includes('cloudflare') && (lower.includes('ray id') || lower.includes('security check'))) ||
        (lower.includes('just a moment') && lower.includes('enable javascript')) ||
        (lower.includes('captcha') && lower.includes('verify you are human')) ||
        (lower.includes('access denied') && lower.includes('bot')) ||
        (lower.includes('403') && lower.includes('are you lost')) ||
        (lower.includes('403') && text.length < 500) ||
        (lower.includes('forbidden') && text.length < 500) ||
        (lower.includes('blocked') && lower.includes('access')) ||
        (lower.includes('sorry') && lower.includes('blocked') && text.length < 1000) ||
        (lower.includes('error page') && text.length < 500) ||
        (lower.includes('restricted access') && text.length < 1000);
      if (isBlocked) {
        errors.push('blocked');
        continue;
      }

      // Also reject if content is too short to be a real page
      if (text.length < 200) {
        errors.push('content too short');
        continue;
      }
      return text;
    } catch (err) {
      errors.push(err.message);
    }
  }
  // All proxies failed — return null so callers can try alternative sources
  return null;
}

// Fallback: search Google for company info when direct scraping fails
export async function searchCompanyInfo(domain) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(domain + ' company')}`;
  const text = await scrapeWebsite(searchUrl);
  if (text) return text;

  // Try DuckDuckGo as fallback
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(domain + ' company what do they do')}`;
  const ddgText = await scrapeWebsite(ddgUrl);
  if (ddgText) return ddgText;

  return null;
}

export async function scrapeCompanyInfo(url, ctx, lang = 'en') {
  let text = await scrapeWebsite(url);
  let source = 'website';
  const langInstr = lang === 'de' ? 'Write ALL field values in German.' : 'Write ALL field values in English.';

  // If direct scraping failed, try search engines
  if (!text) {
    const domain = new URL(url).hostname.replace('www.', '');
    text = await searchCompanyInfo(domain);
    source = 'search';
  }

  // If all scraping failed, ask Claude with just the URL
  if (!text) {
    const domain = new URL(url).hostname.replace('www.', '');
    const prompt = `You are a data extraction assistant. I could not scrape the website ${url} directly. Based on your knowledge of the company "${domain}", provide company information as a JSON object with these fields:
- "companyName": The official company name (as used on the website / in the market — not the URL)
- "companyDescription": A 2-3 sentence description of what the company does
- "industry": The company's industry
- "size": Estimated company size — use "Unknown" if not clear
- "location": Company headquarters location — use "Unknown" if not clear
- "targetCustomers": Who their target customers are
- "keyProblems": What key problems they solve

${langInstr}
If you don't know the company, make reasonable inferences from the domain name and return "Unknown" for fields you can't determine.

Return ONLY the JSON object, no markdown, no explanation.`;

    const response = await callClaude(prompt, ctx);
    try {
      return JSON.parse(response);
    } catch {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Failed to parse company info');
    }
  }

  const prompt = `You are a data extraction assistant. Given the following ${source === 'search' ? 'search results about a company' : 'website text'}, extract company information and return ONLY a valid JSON object with these fields:
- "companyName": The official company name as used on the website (not the URL or a product line) — required
- "companyDescription": A 2-3 sentence description of what the company does
- "industry": The company's industry
- "size": Estimated company size (e.g. "10-50 employees", "Enterprise", "Startup") — use "Unknown" if not clear
- "location": Company headquarters location — use "Unknown" if not clear
- "targetCustomers": Who their target customers are
- "keyProblems": What key problems they solve

${langInstr}

${source === 'search' ? 'Search results' : 'Website text'}:
${text}

Return ONLY the JSON object, no markdown, no explanation.`;

  const response = await callClaude(prompt, ctx);
  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse company info from AI response');
  }
}

const VP_FIELDS_SCHEMA = `{
  "summary": "A comprehensive paragraph (at least 6-10 sentences) providing a thorough overview of the company in third person. Cover what the company does, their history or founding context if notable, core business model, target markets and customer segments, geographic reach, flagship products or services, key differentiators, company size/scale if known, and overall market positioning. Be detailed and specific — do NOT limit yourself to 1 or 2 sentences.",
  "elevatorPitch": "30-second pitch in first person plural starting with 'We help...'",
  "painPoints": "3-5 pain points the target audience faces, as a short paragraph",
  "usps": "3-5 unique selling propositions that differentiate this company",
  "urgency": "Why prospects should act now — market timing, cost of inaction, competitive pressure",
  "services": "Core services or products offered, listed concisely",
  "benefits": "Concrete outcomes and measurable results clients get"
}`;

function parseVpJson(response) {
  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse value proposition JSON');
  }
}

export async function scrapeValueProposition(url, ctx, lang = 'en') {
  let text = await scrapeWebsite(url);
  let source = 'website';
  const langInstr = lang === 'de' ? 'Write ALL field values in German.' : 'Write ALL field values in English.';

  if (!text) {
    const domain = new URL(url).hostname.replace('www.', '');
    text = await searchCompanyInfo(domain);
    source = 'search';
  }

  if (!text) {
    const domain = new URL(url).hostname.replace('www.', '');
    const prompt = `You are a business analyst. I could not scrape the website ${url} directly. Based on your knowledge of the company "${domain}", fill in this value proposition JSON. If you don't have specific knowledge, make reasonable inferences from the domain name. ${langInstr}

Return ONLY this JSON object with all fields filled in:
${VP_FIELDS_SCHEMA}`;
    const response = await callClaude(prompt, ctx, 2048);
    return parseVpJson(response);
  }

  const prompt = `You are a business analyst. Given the following ${source === 'search' ? 'search results about a company' : 'website text'}, extract a comprehensive value proposition. ${langInstr}

Return ONLY this JSON object with all fields filled in:
${VP_FIELDS_SCHEMA}

${source === 'search' ? 'Search results' : 'Website text'}:
${text}`;

  const response = await callClaude(prompt, ctx, 2048);
  return parseVpJson(response);
}

export async function extractVpFromText(text, ctx, lang = 'en') {
  const langInstr = lang === 'de' ? 'Write ALL field values in German.' : 'Write ALL field values in English.';
  const prompt = `You are a business analyst. Given the following website text, extract a comprehensive value proposition. ${langInstr}

Return ONLY this JSON object with all fields filled in:
${VP_FIELDS_SCHEMA}

Website text:
${text}`;
  const response = await callClaude(prompt, ctx, 2048);
  return parseVpJson(response);
}

export async function generateICP(valueProposition, clientName, ctx, lang = 'en') {
  const langInstr = lang === 'de'
    ? 'Write ALL field values in German. The position/role should be in German (e.g. "Leiter Einkauf" not "Head of Purchasing"). Prefer a real company headquartered in the DACH region (Germany, Austria, or Switzerland) when one plausibly fits the value proposition.'
    : 'Write ALL field values in English.';
  const anredeInstr = lang === 'de'
    ? 'anrede MUST be exactly "Herr" or "Frau" — pick based on the gender suggested by the invented first name.'
    : 'anrede MUST be exactly "Mr." or "Ms." (with the trailing period) — pick based on the gender suggested by the invented first name.';
  const prompt = `You are a sales strategist. Given the following company's value proposition, identify a realistic **Ideal Customer Profile (ICP)** — a plausible decision-maker persona at a REAL, currently-operating company that would be an excellent prospect for this business.

## Our Company
${clientName ? `Company: ${clientName}` : ''}
Value Proposition: ${valueProposition}

## Task
1. Think about the ideal buyer: industry, company size, geography, and the role of the person who would decide to buy.
2. If you already know a real, currently-operating company that fits perfectly, use it. If you are NOT sure of a real company that fits, you MUST use the web_search TOOL to discover one — never invent a company name, never use placeholders.
3. USE THE web_search TOOL to verify the company's real homepage URL, headquarters location, products/services they offer, industries they serve, and notable clients or markets. Gather enough detail to write a thorough description.
4. Choose a plausible buyer role at that company (e.g. "Head of Procurement", "VP Engineering"). The person's first and last name should be a realistic-sounding name for the company's country — do NOT name a real private individual; invent a plausible name for the role.

${langInstr}

Return ONLY a valid JSON object with these exact fields, and nothing else:
{
  "anrede": "...",
  "firstName": "...",
  "lastName": "...",
  "position": "...",
  "company": "...",
  "companyWebsite": "https://www.real-company-homepage.com",
  "companyDescription": "A detailed, factually accurate 5-8 sentence description of what this real company actually does — covering their core products/services, target markets and customer segments, industries they serve, geographic reach, notable strengths or specialisations, and any flagship offerings or known clients. Ground every sentence in what you found via web_search.",
  "companyIndustry": "...",
  "companySize": "e.g. 50-200 employees",
  "companyLocation": "City, Country",
  "location": "City, Country"
}

Rules:
1. The prospect company MUST be a REAL, currently-operating company — verified via web_search. Do not invent a company.
2. companyWebsite MUST be the real homepage URL you confirmed via web_search (not a guess, not example.com).
3. companyLocation MUST match the real headquarters you found.
4. companyDescription MUST be a detailed, factually accurate 5-8 sentence description grounded in your web_search findings — cover what they do, who they serve, which industries/markets, geographic reach, and any notable strengths. Do NOT be vague or generic; use specific product names, market segments, and client types wherever possible.
5. The person's role MUST be the likely buyer/decision-maker for this offering at that company; the first/last name is an invented-but-plausible name for a person in that role and region (do NOT use a real individual's name).
6. ${anredeInstr}
7. All fields must be filled — no empty strings.
8. Your FINAL message must contain ONLY the JSON object — no markdown, no commentary, no citations around the JSON.`;

  const response = await callClaudeWithWebSearch(prompt, ctx);
  let parsed;
  try {
    parsed = JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to parse ICP from AI response');
    parsed = JSON.parse(match[0]);
  }
  // Normalise anrede to one of the exact select options (Herr/Frau/Mr./Ms.).
  const raw = String(parsed.anrede || '').trim().toLowerCase().replace(/\./g, '');
  const anredeMap = { herr: 'Herr', frau: 'Frau', mr: 'Mr.', ms: 'Ms.', mrs: 'Ms.', miss: 'Ms.' };
  parsed.anrede = anredeMap[raw] || (lang === 'de' ? 'Herr' : 'Mr.');
  return parsed;
}

export function composeValueProposition(vp) {
  if (!vp) return '';
  if (typeof vp === 'string') return vp;
  return [
    vp.summary,
    vp.elevatorPitch,
    vp.painPoints && `Pain points addressed: ${vp.painPoints}`,
    vp.usps && `Key differentiators: ${vp.usps}`,
    vp.services && `Services: ${vp.services}`,
    vp.benefits && `Client outcomes: ${vp.benefits}`,
    vp.urgency && `Urgency: ${vp.urgency}`,
  ].filter(Boolean).join(' ');
}

export function buildVarMap(lead, project) {
  return {
    '{Anrede}': lead.anrede || '',
    '{FirstName}': lead.firstName || '',
    '{LastName}': lead.lastName || '',
    '{Position}': lead.position || '',
    '{Company}': lead.company || '',
    '{CompanyDescription}': lead.companyDescription || '',
    '{CompanyIndustry}': lead.companyIndustry || '',
    '{CompanySize}': lead.companySize || '',
    '{CompanyLocation}': lead.companyLocation || '',
    '{PersonLocation}': lead.location || '',
    '{MyNameFirst}': project.senderFirstName || '',
    '{MyNameLast}': project.senderLastName || '',
    '{op.value_proposition}': composeValueProposition(project.valueProposition),
  };
}

export function substituteVariables(template, varMap) {
  let result = template;
  for (const [key, value] of Object.entries(varMap)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

export async function generateMessage(message, varMap, ctx, lang = 'en') {
  if (message.type === 'static') {
    return substituteVariables(message.prompt, varMap);
  }
  // AI message: wrap the body in the globally-configured prelude/postlude,
  // unless this message was flagged as having its own custom framing.
  let full;
  if (message.hasCustomFraming) {
    full = message.prompt;
  } else {
    const pre = getEffectivePrelude(lang);
    const post = getEffectivePostlude(lang);
    full = `${pre}\n---\n${message.prompt}\n---\n${post}`;
  }
  const resolved = substituteVariables(full, varMap);

  const normalized = typeof ctx === 'string' ? {} : (ctx || {});
  const cfg = normalized.defaultMessageModel || getDefaultMessageModel();

  // Share-mode: server proxies upstream using owner's stored key + chosen provider.
  if (normalized.shareToken) {
    const data = await callShareAi(normalized.shareToken, {
      providerId: cfg.providerId,
      model: cfg.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: resolved }],
    });
    return data.content[0].text;
  }

  // Logged-in: always dispatch via the configured default provider.
  const provider = getAiProvider(cfg.providerId);
  if (!provider) throw new Error(`Provider "${cfg.providerId}" is not configured. Open Settings → AI Providers.`);
  const apiKey = getApiKey(cfg.providerId);
  if (!apiKey) throw new Error(`Set the API key for ${provider.name} in Settings → AI Providers.`);
  return await callProvider({
    provider,
    apiKey,
    model: cfg.model,
    userPrompt: resolved,
    maxTokens: 1024,
  });
}

// Given a prompt template and the generated output, produce segments
// marking which parts of the output are static (from template) vs generated (from [...] or {Var} replacements)
export function diffOutputWithTemplate(template, output, varMap) {
  if (!template || !output) return [{ type: 'generated', value: output || '' }];

  // Find the message body section (after the --- delimiter)
  const parts = template.split(/^---$/m);
  const bodySection = parts.length >= 2 ? parts[1] : template;
  // Get just the template body (before the next --- or ## Rules)
  const bodyEnd = bodySection.search(/^---$|^## Rules/m);
  const body = bodyEnd > 0 ? bodySection.slice(0, bodyEnd) : bodySection;

  // Extract static text fragments from the template body
  // Remove {Variable} tokens and [...] instruction blocks, keep the rest
  const staticParts = body
    .replace(/\{[^}]+\}/g, '\x00')  // mark variable positions
    .replace(/\[[^\]]+\]/g, '\x00') // mark bracket positions
    .split('\x00')
    .map(s => s.trim())
    .filter(s => s.length > 3); // only meaningful fragments

  if (staticParts.length === 0) return [{ type: 'generated', value: output }];

  // Now find these static fragments in the output and mark everything between as "generated"
  const segments = [];
  let remaining = output;

  for (const fragment of staticParts) {
    const idx = remaining.toLowerCase().indexOf(fragment.toLowerCase());
    if (idx === -1) continue;

    // Everything before the match is generated
    if (idx > 0) {
      segments.push({ type: 'generated', value: remaining.slice(0, idx) });
    }
    // The match itself is static
    segments.push({ type: 'static', value: remaining.slice(idx, idx + fragment.length) });
    remaining = remaining.slice(idx + fragment.length);
  }

  // Anything left is generated
  if (remaining.length > 0) {
    segments.push({ type: 'generated', value: remaining });
  }

  return segments.length > 0 ? segments : [{ type: 'generated', value: output }];
}

export function highlightVars(template) {
  // Returns an array of {type: 'text'|'var'|'bracket', value} segments
  // Matches both {Variable} tokens and [...] instruction sections
  const segments = [];
  const regex = /(\{[^}]+\}|\[[^\]]+\])/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: template.slice(lastIndex, match.index) });
    }
    const token = match[1];
    if (token.startsWith('{')) {
      segments.push({
        type: 'var',
        value: token,
        isOp: token.startsWith('{op.'),
      });
    } else {
      segments.push({
        type: 'bracket',
        value: token,
      });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < template.length) {
    segments.push({ type: 'text', value: template.slice(lastIndex) });
  }
  return segments;
}
