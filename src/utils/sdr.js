// AI SDR Playground helpers.
// - generatePersonas: one Claude call that returns N varied, realistic personas.
// - simulatePersonaReply: Claude plays the prospect.
// - runWorkflow: executes a workflow's ordered layers[] against the chosen
//   providers, threading each layer's output into the next layer's context.

import { callClaude, callClaudeWithWebSearch, composeValueProposition } from './ai';
import { callProvider, tryParseJsonLoose } from './aiProviders';
import { render as renderJinjaLite, JinjaLiteError } from './jinjaLite';
import { getAiProvider, getApiKey } from './storage';

function parseJsonLooseStrict(text) {
  if (!text) throw new Error('empty_response');
  const parsed = tryParseJsonLoose(text);
  if (parsed !== null && parsed !== undefined) return parsed;
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
  const parsed = parseJsonLooseStrict(response);
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

// ---------- Transcript formatting ----------
export function transcriptToText(turns, { includeTimestamps = false } = {}) {
  if (!Array.isArray(turns) || turns.length === 0) return '(no messages yet)';
  return turns.map((t) => {
    const who = t.role === 'sdr' ? 'SDR' : 'Prospect';
    const ts = includeTimestamps && t.createdAt ? `[${t.createdAt}] ` : '';
    return `${ts}${who}: ${t.text}`;
  }).join('\n\n');
}

function lastByRole(turns, role) {
  if (!Array.isArray(turns)) return '';
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === role) return turns[i].text || '';
  }
  return '';
}

// Fake future timeslots for the playground (no real calendar).
function futureTimeslots(count = 5) {
  const out = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
    d.setHours(i % 2 === 0 ? 10 : 14, 0, 0, 0);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    out.push(`- ${day} at ${time}`);
  }
  return out.join('\n');
}

// The five steering flavours the UI exposes for the simulated prospect reply.
// Unknown / missing → 'natural' (unbiased, used for the modal's initial seed).
export const RESPONSE_TYPES = [
  { id: 'objection',        label: 'Objection' },
  { id: 'positive',         label: 'Positive' },
  { id: 'not_interested',   label: 'Not interested' },
  { id: 'negative',         label: 'Negative' },
  { id: 'not_right_person', label: 'Not the right person' },
];

function responseTypeInstruction(responseType, language) {
  switch (responseType) {
    case 'objection':
      return 'Raise ONE concrete objection or concern (e.g. price, timing, fit, "we already have a provider", internal resourcing, legal/compliance). Be specific and professional, not hostile.';
    case 'positive': {
      const opener = language === 'de'
        ? 'Start with an acceptance phrase in German, e.g. "Gerne, …", "Ja, passt — …", or "Klingt gut, …".'
        : 'Start with an acceptance phrase in English, e.g. "Yes — …", "Happy to — …", or "Sounds good, …".';
      return [
        "You MUST accept the call-to-action in the SDR's most recent message.",
        "If they asked for a call or meeting: say yes and either propose a concrete time (e.g. next Tuesday morning) or accept a time they already offered.",
        "If they asked a yes/no question: answer yes in one sentence.",
        "Hard rules for this reply:",
        "- Your reply MUST NOT contain a question mark. No questions of any kind, not even rhetorical or clarifying ones.",
        "- Do not pivot to a different topic. Do not ask for more details, materials, decks, pricing, or clarification — just commit.",
        `- ${opener}`,
        "- Keep it to 1–2 short sentences.",
      ].join('\n');
    }
    case 'not_interested':
      return "Politely decline. Keep it short and friendly. Don't give reasons. Don't invite further follow-ups.";
    case 'negative':
      return 'React sharply or dismissively — annoyed, very brief, or asking them to stop reaching out. Still professional, but cold.';
    case 'not_right_person':
      return "Say you're not the right person for this. Either suggest a role/department to contact instead, or say you genuinely don't know who handles it.";
    default:
      return 'Respond naturally — you may be curious, sceptical, brief, or even dismissive depending on how well the message landed. Not every message to you hits.';
  }
}

// Claude plays the prospect — produces ONE reply to the most-recent SDR message.
// `responseType` (optional) steers the flavour of the reply; see RESPONSE_TYPES.
export async function simulatePersonaReply(persona, project, turns, apiKey, lang, responseType) {
  const language = lang || project?.language || 'en';
  const langInstr = language === 'de'
    ? 'Antworte auf Deutsch. Kurz halten, wie auf LinkedIn üblich.'
    : 'Reply in British English. Keep it short, like real LinkedIn replies.';
  const senderFirst = project?.senderFirstName || 'someone';
  const senderLast = project?.senderLastName || '';
  const transcript = transcriptToText(turns);
  const steer = responseTypeInstruction(responseType, language);

  const prompt = `You are ${persona.firstName} ${persona.lastName}, ${persona.position} at ${persona.company}.
You are on LinkedIn and have just received a message (and possibly earlier exchanges) from ${senderFirst} ${senderLast}.

About your company (${persona.company}): ${persona.companyDescription || ''} Industry: ${persona.companyIndustry || ''}. Location: ${persona.companyLocation || ''}.

Conversation so far:
${transcript}

${steer}

Guidelines:
- Keep it SHORT. Real LinkedIn replies are usually 1–3 short sentences, around 25–55 words total.
- Sound like a real person — natural, conversational, sometimes terse.
- Don't sign off with the sender's name or your own name.
- Never exceed 70 words.
- ${langInstr}
- Output the reply text ONLY. No preamble, no quotes, no headers.`;

  return await callClaude(prompt, apiKey, 800);
}

// ---------- Workflow runner ----------

function hostFromUrl(url) {
  if (!url) return '';
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).host.replace(/^www\./, ''); }
  catch { return ''; }
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

function buildWorkflowContext({ persona, project, turns, customerName, lang, plo }) {
  const language = lang || project?.language || 'en';
  const vp = composeValueProposition(project?.valueProposition) || '';
  const ctx = {
    // persona
    FirstName: persona.firstName || '',
    LastName: persona.lastName || '',
    FullName: `${persona.firstName || ''} ${persona.lastName || ''}`.trim(),
    Position: persona.position || '',
    Company: persona.company || '',
    CompanyDescription: persona.companyDescription || '',
    CompanyIndustry: persona.companyIndustry || '',
    PersonaLocation: persona.location || persona.companyLocation || '',
    // legacy aliases used by some prompts
    PersonaFirstName: persona.firstName || '',
    PersonaLastName: persona.lastName || '',
    PersonaPosition: persona.position || '',
    PersonaCompany: persona.company || '',
    PersonaCompanyDescription: persona.companyDescription || '',
    PersonaIndustry: persona.companyIndustry || '',
    // sender
    MyNameFirst: project?.senderFirstName || '',
    MyNameLast: project?.senderLastName || '',
    MyNameFull: `${project?.senderFirstName || ''} ${project?.senderLastName || ''}`.trim(),
    // deal
    CustomerName: customerName || project?.clientName || '',
    ValueProposition: vp,
    Language: language === 'de' ? 'German' : 'English',
    // runtime
    Datetime: new Date().toISOString(),
    Transcript: transcriptToText(turns),
    Conversation: transcriptToText(turns),
    'Conversation:include_timestamps': transcriptToText(turns, { includeTimestamps: true }),
    // Common aliases so workflow templates authored with different naming
    // conventions still resolve to the actual transcript instead of rendering
    // blank (which would make Claude say "conversation history required").
    transcript: transcriptToText(turns),
    conversation: transcriptToText(turns),
    conversation_history: transcriptToText(turns),
    conversationHistory: transcriptToText(turns),
    chat_history: transcriptToText(turns),
    chatHistory: transcriptToText(turns),
    messages: transcriptToText(turns),
    history: transcriptToText(turns),
    Timeslots: futureTimeslots(5),
    'Timeslots:smart': futureTimeslots(5),
    LastPersonaReply: lastByRole(turns, 'persona'),
    last_persona_reply: lastByRole(turns, 'persona'),
    lastReply: lastByRole(turns, 'persona'),
    // nested objects for {{ x.y }} access
    op: {
      company_name: customerName || project?.clientName || '',
      elevator_pitch: vp,
      value_proposition: vp,
      value_prop: vp,
    },
    sdr_settings: {
      pitch_text_short: truncate(vp, 500),
    },
    psl: {
      person: {
        company: { domain: hostFromUrl(persona.companyWebsite) },
      },
    },
    // plo (previous layer output) — null before layer 1
    plo: plo || { text: '', json: {} },
  };
  return ctx;
}

export async function runWorkflow({ workflow, persona, project, turns, customerName, lang, onProgress }) {
  if (!workflow || !Array.isArray(workflow.layers) || workflow.layers.length === 0) {
    throw new Error('Workflow has no layers');
  }

  const results = [];
  let plo = { text: '', json: {} };

  for (let i = 0; i < workflow.layers.length; i++) {
    const layer = workflow.layers[i];
    const label = layer.name || `Layer ${i + 1}`;
    if (onProgress) onProgress({ index: i, label, status: 'running' });

    const ctx = buildWorkflowContext({ persona, project, turns, customerName, lang, plo });

    let userPrompt;
    let systemMessage = '';
    try {
      userPrompt = renderJinjaLite(layer.content || '', ctx);
      if (layer.systemMessage) systemMessage = renderJinjaLite(layer.systemMessage, ctx);
    } catch (err) {
      const msg = err instanceof JinjaLiteError
        ? `${label}: ${err.message}`
        : `${label}: template error — ${err.message}`;
      throw new Error(msg);
    }

    // Safety net: if the rendered prompt doesn't reference ANY conversation
    // token, the model would otherwise see no history and refuse to respond.
    // Auto-append the transcript so workflows can never silently lose context.
    const transcriptText = transcriptToText(turns);
    const hasTurns = Array.isArray(turns) && turns.length > 0;
    const sourceTpl = (layer.content || '') + ' ' + (layer.systemMessage || '');
    const referencesConversation = /\{\{?\s*(Conversation|Transcript|conversation|transcript|conversation_history|conversationHistory|chat_history|chatHistory|messages|history|LastPersonaReply|last_persona_reply|lastReply)(:[\w-]+)?\s*\}?\}/.test(sourceTpl);
    if (hasTurns && !referencesConversation) {
      const block = `\n\n## Conversation history so far\n\n${transcriptText}\n`;
      userPrompt = `${userPrompt || ''}${block}`;
    }

    const provider = getAiProvider(layer.providerId);
    if (!provider) throw new Error(`${label}: unknown provider "${layer.providerId}"`);
    const apiKey = getApiKey(provider.id);
    if (!apiKey) throw new Error(`${label}: missing API key for "${provider.name}" — set it in Settings → AI Providers`);

    const text = await callProvider({
      provider,
      apiKey,
      model: layer.model,
      systemMessage,
      userPrompt,
      temperature: Number(layer.temperature ?? 0.6),
      maxTokens: 1800,
    });
    const json = tryParseJsonLoose(text);
    plo = { text, json: json || {} };
    results.push({ layerId: layer.id, label, text, json });
    if (onProgress) onProgress({ index: i, label, status: 'done' });
  }

  const last = results[results.length - 1];

  const hasJson = !!last.json;
  const sendExplicitlyFalse = hasJson && last.json.send_message_now === false;
  const functionCall = last.json?.function_call || null;
  const functionParameters = last.json?.function_parameters || null;

  // Extract final_output cleanly, treating "None"/"null"/empty as absent.
  // (Production workflows commonly return final_output: None / "None" when
  // send_message_now is False.)
  let finalText = '';
  const raw = last.json?.final_output;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t && t !== 'None' && t !== 'null') finalText = raw;
  } else if (raw && typeof raw === 'object') {
    finalText = String(raw);
  }

  // Suppress the SDR bubble when the workflow explicitly opted out, or when
  // it parsed JSON and final_output was genuinely null/None. We do NOT suppress
  // when the model returned raw prose with no JSON at all — that's a well-
  // formed reply we just fall back to.
  const outputExplicitlyMissing = hasJson && !finalText;
  const suppressed = sendExplicitlyFalse || outputExplicitlyMissing;

  // If the model returned no JSON at all, use the raw response as the message.
  if (!suppressed && !finalText) finalText = last.text;

  return {
    final: finalText,
    suppressed,
    sendMessageNow: sendExplicitlyFalse ? false : true,
    functionCall,
    functionParameters,
    layers: results,
  };
}

// Kept for backward-compat imports elsewhere; now delegates to runWorkflow.
export async function generateSdrReply({ workflow, persona, project, turns, customerName, lang }) {
  const res = await runWorkflow({ workflow, persona, project, turns, customerName, lang });
  return res.final;
}

// Variable tokens surfaced in the editor so users know what's available.
// Grouped by purpose — mirrors the actual context shape produced by
// buildWorkflowContext above. When you add a new context key in code,
// add it here too so the editor surface picks it up.
export const SDR_WORKFLOW_TOKEN_GROUPS = [
  {
    label: 'Persona (the lead)',
    tokens: [
      'FirstName', 'LastName', 'FullName', 'Position', 'Company',
      'CompanyDescription', 'CompanyIndustry', 'PersonaLocation',
      'PersonaFirstName', 'PersonaLastName', 'PersonaPosition',
      'PersonaCompany', 'PersonaCompanyDescription', 'PersonaIndustry',
    ],
  },
  {
    label: 'Sender (the SDR / you)',
    tokens: ['MyNameFirst', 'MyNameLast', 'MyNameFull'],
  },
  {
    label: 'Customer & deal',
    tokens: ['CustomerName', 'ValueProposition', 'Language', 'Datetime'],
  },
  {
    label: 'Conversation history (any of these works)',
    tokens: [
      'Conversation', 'Transcript', 'Conversation:include_timestamps',
      'conversation', 'transcript', 'conversation_history',
      'conversationHistory', 'chat_history', 'chatHistory',
      'messages', 'history',
    ],
  },
  {
    label: 'Last lead reply',
    tokens: ['LastPersonaReply', 'last_persona_reply', 'lastReply'],
  },
  {
    label: 'Scheduling',
    tokens: ['Timeslots', 'Timeslots:smart'],
  },
  {
    label: 'Previous layer output (Layer 2+)',
    tokens: ['plo.text', 'plo.json.situation_key', 'plo.json.final_output'],
  },
  {
    label: 'Nested objects',
    tokens: [
      'op.company_name', 'op.elevator_pitch', 'op.value_proposition',
      'sdr_settings.pitch_text_short', 'psl.person.company.domain',
    ],
  },
];

// Flat list kept as a derived export for any caller still depending on it.
export const SDR_WORKFLOW_TOKENS = SDR_WORKFLOW_TOKEN_GROUPS.flatMap((g) => g.tokens);
