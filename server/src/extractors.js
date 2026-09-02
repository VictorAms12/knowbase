import fs from 'node:fs/promises';
import path from 'node:path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const TEXT_EXTENSIONS = new Set(['.txt', '.sql', '.md', '.csv', '.log', '.json', '.xml', '.js', '.ts', '.ps1', '.bat', '.sh']);

export function classifyMedia(mime = '', originalName = '') {
  const ext = path.extname(originalName).toLowerCase();
  if (mime === 'application/pdf' || ext === '.pdf') return 'PDF';
  if (mime.startsWith('video/') || ['.mp4', '.webm'].includes(ext)) return 'VIDEO';
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return 'IMAGE';
  if (['.docx', '.doc'].includes(ext) || mime.includes('wordprocessingml')) return 'DOCUMENT';
  if (['.xlsx', '.xls', '.csv'].includes(ext) || mime.includes('spreadsheetml')) return 'SPREADSHEET';
  if (['.pptx', '.ppt'].includes(ext) || mime.includes('presentationml')) return 'PRESENTATION';
  if (['.sql', '.ps1', '.bat', '.sh', '.js', '.ts'].includes(ext)) return 'SCRIPT';
  if (['.zip', '.rar', '.7z'].includes(ext) || mime.includes('zip')) return 'ARCHIVE';
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) return 'TEXT';
  return 'DOCUMENT';
}

export async function extractFileText(filePath, mime = '', originalName = '') {
  const ext = path.extname(originalName).toLowerCase();
  try {
    if (mime === 'application/pdf' || ext === '.pdf') {
      const buffer = await fs.readFile(filePath);
      const parsed = await pdfParse(buffer);
      return cleanText(parsed.text).slice(0, 1_500_000);
    }

    if (ext === '.docx' || mime.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ path: filePath });
      return cleanText(result.value).slice(0, 1_500_000);
    }

    if (['.xlsx', '.xls', '.csv'].includes(ext) || mime.includes('spreadsheetml')) {
      const book = XLSX.readFile(filePath, { cellText: true, cellDates: true });
      const chunks = [];
      for (const name of book.SheetNames.slice(0, 60)) {
        const sheet = book.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        chunks.push(`PLANILHA: ${name}\n${csv}`);
        if (chunks.join('\n').length > 1_500_000) break;
      }
      return cleanText(chunks.join('\n\n')).slice(0, 1_500_000);
    }

    if (ext === '.pptx' || mime.includes('presentationml')) {
      const buffer = await fs.readFile(filePath);
      const zip = await JSZip.loadAsync(buffer);
      const slideNames = Object.keys(zip.files)
        .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
      const slides = [];
      for (const slideName of slideNames) {
        const xml = await zip.files[slideName].async('string');
        const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map(m => decodeXml(m[1]))
          .filter(Boolean);
        slides.push(`${slideName.replace(/^.*slide/, 'SLIDE ').replace('.xml', '')}\n${texts.join(' ')}`);
      }
      return cleanText(slides.join('\n\n')).slice(0, 1_500_000);
    }

    if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) {
      const text = await fs.readFile(filePath, 'utf8');
      return cleanText(text).slice(0, 1_500_000);
    }
  } catch (error) {
    console.warn(`[extractor] ${originalName}: ${error.message}`);
  }
  return '';
}

export function detectProvider(url = '') {
  const lower = String(url).toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YOUTUBE';
  if (lower.includes('vimeo.com')) return 'VIMEO';
  if (lower.includes('loom.com')) return 'LOOM';
  if (lower.includes('drive.google.com')) return 'GOOGLE_DRIVE';
  if (lower.includes('microsoftstream.com') || lower.includes('stream.microsoft.com') || lower.includes('sharepoint.com')) return 'MICROSOFT_STREAM';
  return 'EXTERNAL';
}

export function toEmbedUrl(url = '', provider = detectProvider(url)) {
  try {
    const u = new URL(url);
    if (provider === 'YOUTUBE') {
      if (u.hostname.includes('youtu.be')) return `https://www.youtube.com/embed/${u.pathname.replace('/', '')}`;
      const id = u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop();
      return id ? `https://www.youtube.com/embed/${id}` : url;
    }
    if (provider === 'VIMEO') {
      const id = u.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : url;
    }
    if (provider === 'LOOM') {
      return url.replace('/share/', '/embed/');
    }
    if (provider === 'GOOGLE_DRIVE') {
      const match = url.match(/\/file\/d\/([^/]+)/);
      return match ? `https://drive.google.com/file/d/${match[1]}/preview` : url;
    }
  } catch {
    return url;
  }
  return url;
}

function cleanText(value = '') {
  return String(value)
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function decodeXml(value = '') {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
