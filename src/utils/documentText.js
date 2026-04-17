import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_COMBINED_CHARS = 30000;

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

async function extractPdf(file) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  return pages.join('\n');
}

async function extractDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value;
}

export async function extractTextFromFile(file) {
  const ext = extOf(file.name);
  const mime = file.type || '';
  if (ext === 'pdf' || mime === 'application/pdf') return extractPdf(file);
  if (
    ext === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractDocx(file);
  }
  if (ext === 'txt' || ext === 'md' || mime.startsWith('text/')) {
    return file.text();
  }
  throw new Error(`Unsupported file type: ${file.name}`);
}

export async function extractTextFromFiles(files) {
  const parts = [];
  for (const file of files) {
    const text = await extractTextFromFile(file);
    parts.push(`--- ${file.name} ---\n${text}`);
  }
  const combined = parts.join('\n\n').replace(/[ \t\u00A0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (combined.length > MAX_COMBINED_CHARS) {
    return { text: combined.slice(0, MAX_COMBINED_CHARS), truncated: true };
  }
  return { text: combined, truncated: false };
}
