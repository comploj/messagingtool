// AI SDR Playground helpers.
// - generatePersonas: one Claude call that returns N varied, realistic personas.
// - simulatePersonaReply: Claude plays the prospect.
// - generateSdrReply: the project's selected SDR workflow prompt, filled in and
//   sent to Claude, to produce the next message from our AI SDR.

import { callClaude, callClaudeWithWebSearch, composeValueProposition } from './ai';

function parseJsonLoose(text) {
  if (!text) throw new Error('empty_response');
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('Failed to parse JSON from AI response');
}

// Generate `count` varied ICP-matching personas in ONE Claude call.
// Uses web_search (max_uses shared across all personas) for realism.
export async function generatePersonas(valueProposition, clientName, count, lang, apiKey) {
  const langInstr = lang === 'de'
    ? 'Write ALL field values in German. Use realistic names for the DACH region. Prefer real companies headquartered in Germany, Austria, or Switzerland when plausible.'
    : 'Write ALL field values in English.';
  const prompt = `You are a sales strategist. Produce ${count} REALISTIC Ideal Customer Profile personas that match the value proposition below. Each persona should look genuinely different: different industry, different company size, different region, different seniority of role.

## Our Company
${clientName ? `Company: ${clientName}` : ''}
Value Proposition: ${valueProposition}

## Task
1. Think about the ideal buyer across industries, company sizes, geographies and roles.
2. USE THE web_search TOOL as needed to find REAL, currently-operating companies that fit the buyer profile.
3. For each persona, verify the company's real homepage, headquarters, industry, and what they do.
4. Choose a plausible buyer role at that company (e.g. "Head of Procurement", "VP Engineering"). First + last names are invented-but-plausible names for the role's country. Do NOT name real private individuals.

${langInstr}

Return ONLY a JSON ARRAY of ${count} objects with exactly these fields, and NOTHING else:
[
  {
    "firstName": "...",
    "lastName": "...",
    "position": "...",
    "company": "...",
    "companyWebsite": "https://www.real-homepage.com",
    "companyDescription": "2-3 sentences about what the real company does",
    "companyIndustry": "...",
    "companySize": "e.g. 50-200 employees",
    "companyLocation": "City, Country",
    "location": "City, Country"
  },
  ...
]

Rules:
1. Each company MUST be real and currently operating (verified via web_search).
2. The ${count} personas MUST be diverse (no two in the same industry; vary size + region + role seniority).
3. companyWebsite MUST be the real homepage URL you confirmed.
4. All fields must be filled — no empty strings.
5. Your FINAL message must contain ONLY the JSON array — no markdown, no commentary.`;

  const response = await callClaudeWithWebSearch(prompt, apiKey, 4096, Math.max(count, 5));
  const parsed = parseJsonLoose(response);
  if (!Array.isArray(parsed)) throw new Error('Expected array of personas');
  return parsed.slice(0, count).map((p) => ({
    id: (globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    position: p.position || '',
    company: p.company || '',
    companyWebsite: p.companyWebsite || '',
    companyDescription: p.companyDescription || '',
    companyIndustry: p.companyIndustry || '',
    companySize: p.companySize || '',
    companyLocation: p.companyLocation || '',
    location: p.location || '',
  }));
}

function transcriptToText(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return '(no messages yet)';
  return turns.map((t) => {
    const who = t.role === 'sdr' ? 'SDR' : 'Prospect';
    return `${who}: ${t.text}`;
  }).join('\n\n');
}

function lastByRole(turns, role) {
  if (!Array.isArray(turns)) return '';
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === role) return turns[i].text || '';
  }
  return '';
}

// Claude plays the prospect — produces ONE reply to the most-recent SDR message.
export async function simulatePersonaReply(persona, project, turns, apiKey, lang) {
  const language = lang || project?.language || 'en';
  const langInstr = language === 'de'
    ? 'Antworte auf Deutsch.'
    : 'Reply in British English.';
  const senderFirst = project?.senderFirstName || 'someone';
  const senderLast = project?.senderLastName || '';
  const transcript = transcriptToText(turns);

  const prompt = `You are ${persona.firstName} ${persona.lastName}, ${persona.position} at ${persona.company}.
You are on LinkedIn and have just received a message (and possibly earlier exchanges) from ${senderFirst} ${senderLast}.

About your company (${persona.company}): ${persona.companyDescription || ''} Industry: ${persona.companyIndustry || ''}. Location: ${persona.companyLocation || ''}.

Conversation so far:
${transcript}

Write ONE natural reply, in your own voice. Guidelines:
- Be realistic — sometimes curious, sometimes sceptical, sometimes brief and dismissive. Not every message to you lands.
- Don't be over-enthusiastic unless the message really hit the mark.
- It's OK to ask a clarifying question, push back, or decline politely.
- Max 120 words.
- ${langInstr}
- Output the reply text ONLY. No preamble, no quotes, no sign-off with the sender's name.`;

  return await callClaude(prompt, apiKey, 800);
}

// Run the project's selected SDR workflow to produce the next SDR reply.
const VAR_TOKENS = [
  'PersonaFirstName', 'PersonaLastName', 'PersonaPosition',
  'PersonaCompany', 'PersonaCompanyDescription', 'PersonaIndustry',
  'PersonaLocation', 'Transcript', 'LastPersonaReply',
  'MyNameFirst', 'MyNameLast', 'ValueProposition',
  'CustomerName', 'Language',
];

function buildSdrVarMap(persona, project, turns, customerName, lang) {
  const language = lang || project?.language || 'en';
  const values = {
    PersonaFirstName: persona.firstName || '',
    PersonaLastName: persona.lastName || '',
    PersonaPosition: persona.position || '',
    PersonaCompany: persona.company || '',
    PersonaCompanyDescription: persona.companyDescription || '',
    PersonaIndustry: persona.companyIndustry || '',
    PersonaLocation: persona.location || persona.companyLocation || '',
    Transcript: transcriptToText(turns),
    LastPersonaReply: lastByRole(turns, 'persona'),
    MyNameFirst: project?.senderFirstName || '',
    MyNameLast: project?.senderLastName || '',
    ValueProposition: composeValueProposition(project?.valueProposition) || '',
    CustomerName: customerName || project?.clientName || '',
    Language: language === 'de' ? 'German' : 'English',
  };
  return values;
}

function substituteWorkflowVars(template, vars) {
  if (!template) return '';
  let out = template;
  for (const key of VAR_TOKENS) {
    const re = new RegExp(`\\{${key}\\}`, 'g');
    out = out.replace(re, vars[key] ?? '');
  }
  return out;
}

export async function generateSdrReply({ workflow, persona, project, turns, customerName, apiKey, lang }) {
  if (!workflow || !workflow.prompt) throw new Error('No SDR workflow configured');
  const vars = buildSdrVarMap(persona, project, turns, customerName, lang);
  const resolved = substituteWorkflowVars(workflow.prompt, vars);
  return await callClaude(resolved, apiKey, 1024);
}

export const SDR_WORKFLOW_TOKENS = VAR_TOKENS.slice();
