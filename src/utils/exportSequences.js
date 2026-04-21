import * as XLSX from 'xlsx';
import {
  getEffectivePrelude,
  getEffectivePostlude,
  getEffectiveStaticFollowups,
} from './promptOverrides';

// Placeholder used by the reference sheet for AI Outcome cells when no real
// generated output is present. Matches what the user's "leadhunt" template expects.
const AI_OUTCOME_PLACEHOLDER =
  '1. Find a few matching prospects from the right industry and with the right position and test the promt under the AI Playground.\n\n' +
  '2. Make sure you are happy with the outcome. If not, try to adjust the prompt or reach out to David G.\n\n' +
  '3. Once you are happy with the outcome, paste it in this cell and mark all the AI tailored parts in blue for the customer to immediately spot the personalization.';

const MAX_MESSAGES = 5; // Reference sheet supports Message 1..5

// Row layout, in order. Each row has a label in column A; per-sequence data
// fills columns B (New Prompt) and a pair (AI Outcome, AI Prompt) for each sequence.
const ROW_LABELS = [
  'Strategy Description', // 2
  'Title',                // 3
  'Connection Request',   // 4
  'Message Type',         // 5
  'Composition',          // 6
  'Subject Line',         // 7
  'AI Model',             // 8
  'Temperature',          // 9
  'System Message',       // 10
];

// For each message slot, the meta rows that follow it.
// (Message N is row X; rows X+1 .. X+6 are meta for Message N.)
const META_ROW_LABELS = [
  'Message Type',
  'Composition',
  'Subject Line',
  'AI Model',
  'Temperature',
  'System Message',
];

function composeFullPrompt(message, lang) {
  if (!message || message.type !== 'ai') return message?.prompt || '';
  if (message.hasCustomFraming) return message.prompt || '';
  const pre = getEffectivePrelude(lang);
  const post = getEffectivePostlude(lang);
  return `${pre}\n---\n${message.prompt || ''}\n---\n${post}`;
}

// Build the rows of one full sheet as a 2D array-of-arrays.
// `sequences` is the full project.sequences array.
// `outputs` is project.outputs (map of messageId -> generated string).
// `customerName` fills {CustomerName} in the titles.
// `lang` is 'en' or 'de'.
function buildSheetRows(sequences, outputs, customerName, lang) {
  const rows = [];

  // Col A header is blank; col B is "New Prompt"; then for each sequence
  // produce ("AI Outcome", "AI Prompt").
  const headerRow = ['', 'New Prompt'];
  for (let i = 0; i < sequences.length; i++) {
    headerRow.push('AI Outcome ', 'AI Prompt');
  }
  rows.push(headerRow);

  // Language labels used in the Title row
  const langLabel = lang === 'de' ? 'German' : 'English';

  // Row 2: Strategy Description — description duplicated across the pair,
  // column B (New Prompt) is blank.
  rows.push([
    'Strategy Description',
    null,
    ...sequences.flatMap((s) => {
      const desc = s.description || '';
      return [desc, desc];
    }),
  ]);

  // Row 3: Title — "{CustomerName} - <lang> - AI Tailored - <StrategyName>"
  // Duplicated across the pair; column B blank.
  const customerTok = customerName || '{CustomerName}';
  rows.push([
    'Title',
    null,
    ...sequences.flatMap((s) => {
      const name = s.name || s.strategyKey || 'Sequence';
      const title = `${customerTok} - ${langLabel} - AI Tailored - ${name}`;
      return [title, title];
    }),
  ]);

  // Row 4: Connection Request — "-" everywhere
  rows.push([
    'Connection Request',
    '-',
    ...sequences.flatMap(() => ['-', '-']),
  ]);

  // Rows 5..10: Connection Request meta (linkedin message, static, null, null, null, null)
  const connMeta = [
    ['Message Type',  'linkedin message'],
    ['Composition',   'static'],
    ['Subject Line',  null],
    ['AI Model',      null],
    ['Temperature',   null],
    ['System Message', null],
  ];
  for (const [label, val] of connMeta) {
    rows.push([
      label,
      val,
      ...sequences.flatMap(() => [val, val]),
    ]);
  }

  // Static followup defaults for the selected language — used to seed the
  // "New Prompt" column's message bodies (Msg 2, 3).
  const followups = getEffectiveStaticFollowups(lang);

  // For each message slot 1..MAX_MESSAGES, emit:
  //   - delay row (value = this message's delayDays, or null if not present)
  //   - Message N row (the content)
  //   - 6 meta rows
  for (let i = 0; i < MAX_MESSAGES; i++) {
    const slotNum = i + 1;

    // Per-sequence lookups for this slot
    const msgPerSeq = sequences.map((s) => (s.messages || [])[i] || null);

    // Default delay for the "New Prompt" column (column B).
    // Slot 1 -> 1 day (factory default for first message), slots 2/3 -> followups delay,
    // slot 4 -> 15 (reference), slot 5 -> null.
    const defaultDelay =
      slotNum === 1 ? 1
      : slotNum === 2 ? (followups[0]?.delayDays ?? 5)
      : slotNum === 3 ? (followups[1]?.delayDays ?? 8)
      : slotNum === 4 ? 15
      : null;

    rows.push([
      'delay between messages (days)',
      defaultDelay != null ? String(defaultDelay) : null,
      ...sequences.flatMap((s) => {
        const m = (s.messages || [])[i] || null;
        const d = m?.delayDays != null ? String(m.delayDays) : null;
        return [d, d];
      }),
    ]);

    // Message N row: AI Outcome = generated output (if any) OR placeholder for AI
    //                AI Prompt  = composed full prompt (AI) or static body (static)
    // Column B (New Prompt): blank for AI slot 1, default static followup for 2/3, blank otherwise.
    const bNewPrompt =
      slotNum === 1
        ? null
        : slotNum === 2
        ? (followups[0]?.prompt ?? '')
        : slotNum === 3
        ? (followups[1]?.prompt ?? '')
        : null;

    rows.push([
      `Message ${slotNum}`,
      bNewPrompt,
      ...msgPerSeq.flatMap((m) => {
        if (!m) return [null, null];
        if (m.type === 'ai') {
          const out = outputs?.[m.id];
          const outcome = out && typeof out === 'string' && out.trim() ? out : AI_OUTCOME_PLACEHOLDER;
          const prompt = composeFullPrompt(m, lang);
          return [outcome, prompt];
        }
        // static: outcome and prompt are the same static body
        const body = m.prompt || '';
        return [body, body];
      }),
    ]);

    // Meta rows for this message
    for (const label of META_ROW_LABELS) {
      rows.push([
        label,
        metaDefault(label, slotNum, 'new'),
        ...msgPerSeq.flatMap((m) => {
          const v = metaForMessage(label, m, slotNum);
          return [v, v];
        }),
      ]);
    }
  }

  return rows;
}

function metaDefault(label, slotNum /* , column */) {
  // "New Prompt" column defaults mirror the reference sheet where slot 1 is
  // AI-by-default and later slots are static.
  if (label === 'Message Type') return 'linkedin message';
  if (label === 'Composition') return slotNum === 1 ? 'ai' : 'static';
  return null;
}

function metaForMessage(label, m, slotNum) {
  if (!m) {
    // Empty slot: still emit sensible defaults so the sheet renders the full grid.
    if (label === 'Message Type') return 'linkedin message';
    if (label === 'Composition') return slotNum === 1 ? 'ai' : 'static';
    return null;
  }
  if (label === 'Message Type') return 'linkedin message';
  if (label === 'Composition') return m.type === 'ai' ? 'ai' : 'static';
  if (label === 'Subject Line') return null;
  if (label === 'AI Model') return m.type === 'ai' ? (m.aiModel || null) : null;
  if (label === 'Temperature') return m.type === 'ai' ? (m.temperature != null ? String(m.temperature) : '0.6') : null;
  if (label === 'System Message') return m.type === 'ai' ? (m.systemMessage || 'You are an helpful assistant') : null;
  return null;
}

function setColWidths(ws, seqCount) {
  // A narrow, B & pair columns wide — matching the reference sheet.
  const widths = [{ wch: 20 }, { wch: 69 }];
  for (let i = 0; i < seqCount; i++) widths.push({ wch: 69 }, { wch: 69 });
  ws['!cols'] = widths;
}

export function buildSequencesWorkbook({ project, customerName }) {
  const lang = project?.language || 'en';
  const sheetName = `Message Sequences - ${lang === 'de' ? 'German' : 'English'}`;
  const sequences = Array.isArray(project?.sequences) ? project.sequences : [];
  const outputs = project?.outputs || {};

  const rows = buildSheetRows(sequences, outputs, customerName, lang);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  setColWidths(ws, sequences.length);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel sheet name max 31 chars
  return wb;
}

export function downloadSequencesXlsx({ project, customerName }) {
  const wb = buildSequencesWorkbook({ project, customerName });
  const safe = (s) => String(s || 'sequences').replace(/[^\w\- ]+/g, '').trim() || 'sequences';
  const filename = `${safe(customerName)} - ${safe(project?.name)} - sequences.xlsx`;
  XLSX.writeFile(wb, filename);
}
