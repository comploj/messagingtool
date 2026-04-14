const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

const CORS_PROXIES = [
  { url: (u) => `/api/scrape?url=${encodeURIComponent(u)}`, format: 'json' },
  { url: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`, format: 'raw' },
  { url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, format: 'json' },
];

export async function callClaude(prompt, apiKey) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
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

export async function scrapeCompanyInfo(url, apiKey) {
  let text = await scrapeWebsite(url);
  let source = 'website';

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
- "companyDescription": A 2-3 sentence description of what the company does
- "industry": The company's industry
- "size": Estimated company size — use "Unknown" if not clear
- "location": Company headquarters location — use "Unknown" if not clear
- "targetCustomers": Who their target customers are
- "keyProblems": What key problems they solve

If you don't know the company, make reasonable inferences from the domain name and return "Unknown" for fields you can't determine.

Return ONLY the JSON object, no markdown, no explanation.`;

    const response = await callClaude(prompt, apiKey);
    try {
      return JSON.parse(response);
    } catch {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Failed to parse company info');
    }
  }

  const prompt = `You are a data extraction assistant. Given the following ${source === 'search' ? 'search results about a company' : 'website text'}, extract company information and return ONLY a valid JSON object with these fields:
- "companyDescription": A 2-3 sentence description of what the company does
- "industry": The company's industry
- "size": Estimated company size (e.g. "10-50 employees", "Enterprise", "Startup") — use "Unknown" if not clear
- "location": Company headquarters location — use "Unknown" if not clear
- "targetCustomers": Who their target customers are
- "keyProblems": What key problems they solve

${source === 'search' ? 'Search results' : 'Website text'}:
${text}

Return ONLY the JSON object, no markdown, no explanation.`;

  const response = await callClaude(prompt, apiKey);
  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse company info from AI response');
  }
}

export async function scrapeValueProposition(url, apiKey) {
  let text = await scrapeWebsite(url);
  let source = 'website';

  if (!text) {
    const domain = new URL(url).hostname.replace('www.', '');
    text = await searchCompanyInfo(domain);
    source = 'search';
  }

  if (!text) {
    const domain = new URL(url).hostname.replace('www.', '');
    const prompt = `You are a business analyst. I could not scrape the website ${url} directly. Based on your knowledge of the company "${domain}", write a clear and compelling 3-5 sentence value proposition paragraph. Describe what the company does, who they help, and what outcomes they deliver. Write in third person.

If you don't have specific knowledge of this company, make reasonable inferences from the domain name.

Return ONLY the value proposition paragraph, no quotes, no markdown.`;
    return await callClaude(prompt, apiKey);
  }

  const prompt = `You are a business analyst. Given the following ${source === 'search' ? 'search results about a company' : 'website text'}, write a clear and compelling 3-5 sentence value proposition paragraph. Describe what the company does, who they help, and what outcomes they deliver. Write in third person.

${source === 'search' ? 'Search results' : 'Website text'}:
${text}

Return ONLY the value proposition paragraph, no quotes, no markdown.`;

  return await callClaude(prompt, apiKey);
}

export async function generateICP(valueProposition, clientName, apiKey) {
  const prompt = `You are a sales strategist. Given the following company's value proposition, generate a realistic **Ideal Customer Profile (ICP)** — a fictional but plausible person at a fictional but realistic company who would be the perfect prospect for this business.

## Our Company
${clientName ? `Company: ${clientName}` : ''}
Value Proposition: ${valueProposition}

## Task
Based on what this company sells and who they serve, create a realistic ideal prospect. The prospect should be:
- A decision-maker at a company that would genuinely benefit from this offering
- In an industry and role that makes sense as a buyer
- At a realistically sized company with a plausible name (NOT a real company — invent one)
- The person name should be realistic for the company's likely geographic market

Return ONLY a valid JSON object with these exact fields:
{
  "firstName": "...",
  "lastName": "...",
  "position": "...",
  "company": "...",
  "companyWebsite": "https://www.example.com",
  "companyDescription": "A 2-3 sentence description of what this prospect company does",
  "companyIndustry": "...",
  "companySize": "e.g. 50-200 employees",
  "companyLocation": "City, Country",
  "location": "City, Country"
}

Rules:
1. The prospect company must be FICTIONAL — do not use a real company name
2. Make the prospect company realistic for the industry
3. The person's role should be the likely buyer/decision-maker for this type of offering
4. All fields must be filled — no empty strings
5. Return ONLY the JSON, no markdown, no explanation`;

  const response = await callClaude(prompt, apiKey);
  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse ICP from AI response');
  }
}

export function buildVarMap(lead, project) {
  return {
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
    '{op.value_proposition}': project.valueProposition || '',
  };
}

export function substituteVariables(template, varMap) {
  let result = template;
  for (const [key, value] of Object.entries(varMap)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

export async function generateMessage(message, varMap, apiKey) {
  const resolved = substituteVariables(message.prompt, varMap);
  if (message.type === 'static') {
    return resolved;
  }
  // AI message
  return await callClaude(resolved, apiKey);
}

export function highlightVars(template) {
  // Returns an array of {type: 'text'|'var', value} segments
  const segments = [];
  const regex = /(\{[^}]+\})/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: template.slice(lastIndex, match.index) });
    }
    const varName = match[1];
    segments.push({
      type: 'var',
      value: varName,
      isOp: varName.startsWith('{op.'),
    });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < template.length) {
    segments.push({ type: 'text', value: template.slice(lastIndex) });
  }
  return segments;
}
