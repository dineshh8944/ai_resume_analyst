import { jsPDF } from 'jspdf'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx'

function save(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const isHeading = (l) => /^[A-Z][A-Z &/,&-]{2,40}$/.test(l.trim()) || /^(summary|objective|profile|skills|technical skills|experience|work experience|projects|education|certifications|achievements|awards)\s*:?\s*$/i.test(l.trim())
const isBullet = (l) => /^\s*[•\-–*▪●◦]\s+/.test(l)
const stripBullet = (l) => l.replace(/^\s*[•\-–*▪●◦]\s+/, '')

export function downloadTxt(text, base = 'resume') {
  save(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`)
}

export async function downloadDocx(text, base = 'resume') {
  const lines = text.split('\n')
  const children = lines.map((raw, i) => {
    const l = raw.replace(/\s+$/, '')
    if (!l.trim()) return new Paragraph({ children: [] })
    if (isHeading(l)) return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: l.trim().toUpperCase(), bold: true, size: 24, font: 'Calibri' })], border: { bottom: { style: 'single', size: 6, color: '999999', space: 1 } } })
    if (isBullet(l)) return new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: stripBullet(l), size: 21, font: 'Calibri' })] })
    if (i === 0) return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: l.trim(), bold: true, size: 36, font: 'Calibri' })] })
    return new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: l, size: 21, font: 'Calibri' })] })
  })
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children }] })
  save(await Packer.toBlob(doc), `${base}.docx`)
}

export function downloadPdf(text, base = 'resume') {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const M = 48, W = pdf.internal.pageSize.getWidth() - M * 2, H = pdf.internal.pageSize.getHeight() - M
  let y = M
  const put = (str, size, bold, indent = 0, gap = 3) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size)
    for (const part of pdf.splitTextToSize(str, W - indent)) {
      if (y > H) { pdf.addPage(); y = M }
      pdf.text(part, M + indent, y); y += size * 1.25
    }
    y += gap
  }
  text.split('\n').forEach((raw, i) => {
    const l = raw.replace(/\s+$/, '')
    if (!l.trim()) { y += 6; return }
    if (i === 0) return put(l.trim(), 18, true, 0, 4)
    if (isHeading(l)) { y += 6; put(l.trim().toUpperCase(), 11.5, true, 0, 1); pdf.setDrawColor(160); pdf.line(M, y - 2, M + W, y - 2); y += 4; return }
    if (isBullet(l)) return put('•  ' + stripBullet(l), 10.5, false, 10, 1)
    put(l, 10.5, false, 0, 1)
  })
  pdf.save(`${base}.pdf`)
}
