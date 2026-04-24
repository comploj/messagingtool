import * as XLSX from 'xlsx';
import {
  getEffectivePrelude,
  getEffectivePostlude,
  getEffectiveStaticFollowups,
} from './promptOverrides';

const MAX_MESSAGES = 5; // Reference sheet supports Message 1..5

// Meta rows that follow each Message N row.
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
// One column per sequence: AI Prompt only (AI Outcome omitted).
// `sequences` is the full project.sequences array.
// `customerName` fills {CustomerName} in the titles.
// `lang` is 'en' or 'de'.
function buildSheetRows(sequences, customerName, lang) {
  const rows = [];

  // Col A = row labels; Col B = "New Prompt" template; then one "AI Prompt"
  // column per sequence.
  const headerRow = ['', 'New Prompt'];
  for (let i = 0; i < sequences.length; i++) headerRow.push('AI Prompt');
  rows.push(headerRow);

  const langLabel = lang === 'de' ? 'German' : 'English';

  // Row 2: Strategy Description
  rows.push([
    'Strategy Description',
    null,
    ...sequences.map((s) => s.description || ''),
  ]);

  // Row 3: Title — "{CustomerName} - <lang> - AI Tailored - <StrategyName>"
  const customerTok = customerName || '{CustomerName}';
  rows.push([
    'Title',
    null,
    ...sequences.map((s) => {
      const name = s.name || s.strategyKey || 'Sequence';
      return `${customerTok} - ${langLabel} - AI Tailored - ${name}`;
    }),
  ]);

  // Row 4: Connection Request — "-" everywhere
  rows.push([
    'Connection Request',
    '-',
    ...sequences.map(() => '-'),
  ]);

  // Rows 5..10: Connection Request meta
  const connMeta = [
    ['Message Type',  'linkedin message'],
    ['Composition',   'static'],
    ['Subject Line',  null],
    ['AI Model',      null],
    ['Temperature',   null],
    ['System Message', null],
  ];
  for (const [label, val] of connMeta) {
    rows.push([label, val, ...sequences.map(() => val)]);
  }

  // Static followup defaults for the selected language.
  const followups = getEffectiveStaticFollowups(lang);

  for (let i = 0; i < MAX_MESSAGES; i++) {
    const slotNum = i + 1;
    const msgPerSeq = sequences.map((s) => (s.messages || [])[i] || null);

    // Default delay for the "New Prompt" column (column B).
    const defaultDelay =
      slotNum === 1 ? 1
      : slotNum === 2 ? (followups[0]?.delayDays ?? 5)
      : slotNum === 3 ? (followups[1]?.delayDays ?? 8)
      : slotNum === 4 ? 15
      : null;

    rows.push([
      'delay between messages (days)',
      defaultDelay != null ? String(defaultDelay) : null,
      ...sequences.map((s) => {
        const m = (s.messages || [])[i] || null;
        return m?.delayDays != null ? String(m.delayDays) : null;
      }),
    ]);

    // Message N row: composed full prompt for AI, static body for static.
    // Column B (New Prompt): blank for AI slot 1, default static followup for 2/3.
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
      ...msgPerSeq.map((m) => {
        if (!m) return null;
        if (m.type === 'ai') return composeFullPrompt(m, lang);
        return m.prompt || '';
      }),
    ]);

    // Meta rows for this message
    for (const label of META_ROW_LABELS) {
      rows.push([
        label,
        metaDefault(label, slotNum),
        ...msgPerSeq.map((m) => metaForMessage(label, m, slotNum)),
      ]);
    }
  }

  return rows;
}

function metaDefault(label, slotNum) {
  if (label === 'Message Type') return 'linkedin message';
  if (label === 'Composition') return slotNum === 1 ? 'ai' : 'static';
  return null;
}

function metaForMessage(label, m, slotNum) {
  if (!m) {
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
  // A narrow, B and each sequence column wide.
  const widths = [{ wch: 20 }, { wch: 69 }];
  for (let i = 0; i < seqCount; i++) widths.push({ wch: 69 });
  ws['!cols'] = widths;
}

export function buildSequencesWorkbook({ project, customerName }) {
  const lang = project?.language || 'en';
  const sheetName = `Message Sequences - ${lang === 'de' ? 'German' : 'English'}`;
  const sequences = Array.isArray(project?.sequences) ? project.sequences : [];

  const rows = buildSheetRows(sequences, customerName, lang);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  setColWidths(ws, sequences.length);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return wb;
}

export function downloadSequencesXlsx({ project, customerName }) {
  const wb = buildSequencesWorkbook({ project, customerName });
  const safe = (s) => String(s || 'sequences').replace(/[^\w\- ]+/g, '').trim() || 'sequences';
  const filename = `${safe(customerName)} - ${safe(project?.name)} - sequences.xlsx`;
  XLSX.writeFile(wb, filename);
}
