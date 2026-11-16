import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const mdPath = path.resolve('docs/11-informe-final.md');
const htmlTempPath = path.resolve('docs/temp_informe.html');
const pdfOutputPath = path.resolve('docs/11-informe-final.pdf');

// 1. Convert Markdown to HTML body using marked
console.log('Generando HTML desde Markdown...');
execSync(`pnpm dlx marked -i "${mdPath}" -o "${htmlTempPath}"`, { stdio: 'inherit' });

const rawHtml = fs.readFileSync(htmlTempPath, 'utf-8');

// 2. Wrap with academic styling CSS
const styledHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe Final - TFI UTN</title>
  <style>
    @page {
      size: A4;
      margin: 20mm 15mm 20mm 15mm;
      @bottom-right {
        content: counter(page);
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.6;
      color: #1f2937;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }
    h1, h2, h3, h4 {
      color: #0f172a;
      font-weight: 700;
      page-break-after: avoid;
    }
    h1 {
      font-size: 18pt;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 6px;
      margin-top: 24pt;
      margin-bottom: 12pt;
    }
    h2 {
      font-size: 14pt;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
      margin-top: 18pt;
      margin-bottom: 8pt;
      color: #1e3a8a;
    }
    h3 {
      font-size: 11.5pt;
      margin-top: 14pt;
      margin-bottom: 6pt;
      color: #1e40af;
    }
    p {
      margin-top: 0;
      margin-bottom: 8pt;
      text-align: justify;
    }
    ul, ol {
      margin-top: 0;
      margin-bottom: 8pt;
      padding-left: 20px;
    }
    li {
      margin-bottom: 3pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10pt;
      margin-bottom: 14pt;
      font-size: 9pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6pt 8pt;
      text-align: left;
    }
    th {
      background-color: #f1f5f9;
      font-weight: 600;
      color: #0f172a;
    }
    tr:nth-child(even) {
      background-color: #f8fafc;
    }
    code {
      font-family: "Cascadia Code", Consolas, Monaco, monospace;
      font-size: 9pt;
      background-color: #f1f5f9;
      padding: 2px 4px;
      border-radius: 4px;
      color: #b91c1c;
    }
    pre {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10pt;
      overflow-x: auto;
      font-size: 8.5pt;
      line-height: 1.4;
      page-break-inside: avoid;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      color: #0f172a;
    }
    blockquote {
      margin: 10pt 0;
      padding: 6pt 12pt;
      border-left: 4px solid #3b82f6;
      background-color: #eff6ff;
      color: #1e40af;
      font-style: italic;
    }
    hr {
      border: 0;
      height: 1px;
      background: #e2e8f0;
      margin: 16pt 0;
    }
    a {
      color: #2563eb;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .cover {
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 90vh;
      text-align: center;
      padding: 40px 20px;
    }
    .cover h1 {
      border: none;
      font-size: 24pt;
      color: #1e3a8a;
      margin-bottom: 20px;
    }
    .cover-meta {
      margin-top: 40px;
      font-size: 11pt;
      line-height: 1.8;
    }
  </style>
</head>
<body>
${rawHtml}
</body>
</html>`;

fs.writeFileSync(htmlTempPath, styledHtml, 'utf-8');

// 3. Render PDF using headless Chrome
console.log('Imprimiendo PDF con Chrome Headless...');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
execSync(`"${chromePath}" --headless --disable-gpu --print-to-pdf="${pdfOutputPath}" --no-pdf-header-footer "${htmlTempPath}"`, { stdio: 'inherit' });

console.log('Eliminando HTML temporal...');
fs.unlinkSync(htmlTempPath);

console.log(`PDF generado exitosamente en: ${pdfOutputPath}`);
