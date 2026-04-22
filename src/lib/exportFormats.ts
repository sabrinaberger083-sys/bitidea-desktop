import type { StoredMessage } from '../types';

/* ──────────────────────────────────────────────────────────
   PDF Export
   Uses jsPDF for basic Latin text. CJK characters may not
   render correctly (no embedded CJK font). For full Chinese
   support, use the Markdown export instead.
   ────────────────────────────────────────────────────────── */
export async function conversationToPdf(
  title: string,
  messages: StoredMessage[],
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const maxWidth = pageWidth - margin * 2;
  let y = 20;

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(title, margin, y);
  y += 10;

  // Date line
  if (messages.length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(128);
    const date = new Date(messages[0].created_at).toISOString().split('T')[0];
    doc.text(date, margin, y);
    y += 8;
    doc.setTextColor(0);
  }

  for (const msg of messages) {
    // New page if we're near the bottom
    if (y > 270) {
      doc.addPage();
      y = 20;
    }

    // Role heading
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    doc.text(roleLabel, margin, y);
    y += 7;

    // Content
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    let content: string;
    if (msg.role === 'user') {
      content = msg.content;
    } else if (msg.events && msg.events.length > 0) {
      const parts: string[] = [];
      for (const ev of msg.events) {
        if (ev.kind === 'text') parts.push(ev.text);
      }
      content = parts.join('');
    } else {
      content = msg.content;
    }

    // Wrap and print, paginating as needed
    const lines = doc.splitTextToSize(content, maxWidth) as string[];
    for (const line of lines) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, margin, y);
      y += 5;
    }

    y += 5;

    // Separator line
    if (y > 280) {
      doc.addPage();
      y = 20;
    }
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
  }

  return doc.output('blob');
}

/* ──────────────────────────────────────────────────────────
   Word Export (docx)
   Full CJK support — content is stored as UTF-8 XML inside
   the .docx zip, so Chinese/Japanese/Korean renders fine in
   Word and LibreOffice.
   ────────────────────────────────────────────────────────── */
export async function conversationToDocx(
  title: string,
  messages: StoredMessage[],
): Promise<Blob> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer, BorderStyle } =
    await import('docx');

  const children: InstanceType<typeof Paragraph>[] = [];

  // Title
  children.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
    }),
  );

  // Date
  if (messages.length > 0) {
    const date = new Date(messages[0].created_at).toISOString().split('T')[0];
    children.push(
      new Paragraph({
        children: [new TextRun({ text: date, color: '888888', size: 20 })],
      }),
    );
    children.push(new Paragraph({})); // blank spacer
  }

  for (const msg of messages) {
    // Role heading
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    children.push(
      new Paragraph({
        text: roleLabel,
        heading: HeadingLevel.HEADING_2,
      }),
    );

    // Resolve content text
    let content: string;
    if (msg.role === 'user') {
      content = msg.content;
    } else if (msg.events && msg.events.length > 0) {
      const parts: string[] = [];
      for (const ev of msg.events) {
        if (ev.kind === 'text') parts.push(ev.text);
      }
      content = parts.join('');
    } else {
      content = msg.content;
    }

    // Each newline becomes its own paragraph
    for (const line of content.split('\n')) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 22 })],
        }),
      );
    }

    // Horizontal rule via bottom border
    children.push(
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        },
      }),
    );
    children.push(new Paragraph({})); // blank spacer
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return await Packer.toBlob(doc);
}
