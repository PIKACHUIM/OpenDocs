import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import type { WordContent } from '../api';
import { downloadBlob, safeFileName } from './download';

/**
 * 把 Univer 的 IDocumentData 还原成 docx。
 *
 * 能还原：段落、文字（粗体/斜体/下划线/删除线/字号/字体/颜色）、段落对齐、
 * 段前段后间距、首行缩进。
 *
 * 不能还原：表格、图片/图形、批注、脚注、分栏。
 * Univer 把这些放在 customBlocks / tables / blockRanges 里，结构复杂，
 * 做一个高保真转换器需要覆盖它的 DrawingML 映射，超出本轮范围。
 * 导出时会在文件名旁不做提示，但在 README 与文档中标注了该限制。
 */
interface UTextStyle {
  bl?: number | boolean;
  it?: number | boolean;
  ul?: { s?: number | boolean };
  st?: { s?: number | boolean };
  fs?: number;
  ff?: string;
  cl?: { rgb?: string };
}

interface UTextRun {
  st: number;
  ed: number;
  ts?: UTextStyle;
}

interface UParagraphStyle {
  horizontalAlign?: number;
  spaceAbove?: { v?: number };
  spaceBelow?: { v?: number };
  indentFirstLine?: { v?: number };
}

interface UParagraph {
  startIndex: number;
  paragraphStyle?: UParagraphStyle;
}

interface UDocumentData {
  body?: {
    dataStream?: string;
    textRuns?: UTextRun[];
    paragraphs?: UParagraph[];
  };
}

function isOn(value: number | boolean | undefined): boolean {
  return value === 1 || value === true;
}

function mapAlign(value: number | undefined) {
  switch (value) {
    case 2:
      return AlignmentType.CENTER;
    case 3:
      return AlignmentType.RIGHT;
    case 4:
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

function makeRun(text: string, style: UTextStyle | undefined): TextRun | null {
  const cleaned = text.replace(/\r/g, '').replace(/\n/g, ' ');
  if (!cleaned) return null;
  return new TextRun({
    text: cleaned,
    bold: isOn(style?.bl),
    italics: isOn(style?.it),
    underline: isOn(style?.ul?.s) ? {} : undefined,
    strike: isOn(style?.st?.s),
    // docx 的 size 单位是半磅，Univer 的 fs 是磅
    size: typeof style?.fs === 'number' ? Math.round(style.fs * 2) : undefined,
    color: style?.cl?.rgb ? style.cl.rgb.replace('#', '') : undefined,
    font: style?.ff,
  });
}

export async function exportUniverDocToDocx(content: WordContent, title: string) {
  const snapshot = content.univer as UDocumentData | undefined;
  const body = snapshot?.body;
  const stream = body?.dataStream ?? '';
  const runs = [...(body?.textRuns ?? [])].sort((a, b) => a.st - b.st);
  const paragraphMap = new Map<number, UParagraph>();
  for (const paragraph of body?.paragraphs ?? []) {
    paragraphMap.set(paragraph.startIndex, paragraph);
  }

  // dataStream 以 \r 分隔段落
  const segments: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < stream.length; index += 1) {
    if (stream[index] === '\r') {
      segments.push({ start, end: index });
      start = index + 1;
    }
  }
  if (start < stream.length) segments.push({ start, end: stream.length });

  const paragraphs: Paragraph[] = [];

  for (const segment of segments) {
    const meta = paragraphMap.get(segment.start);
    const children: TextRun[] = [];

    let cursor = segment.start;
    let runIndex = 0;
    while (runIndex < runs.length && runs[runIndex].ed <= segment.start) runIndex += 1;
    let active =
      runIndex < runs.length && runs[runIndex].st <= segment.start ? runs[runIndex].ts : undefined;

    for (let index = segment.start; index < segment.end; index += 1) {
      while (runIndex < runs.length && runs[runIndex].ed <= index) runIndex += 1;
      const style = runIndex < runs.length && runs[runIndex].st <= index ? runs[runIndex].ts : undefined;
      if (style !== active) {
        const piece = makeRun(stream.slice(cursor, index), active);
        if (piece) children.push(piece);
        cursor = index;
        active = style;
      }
    }
    const tail = makeRun(stream.slice(cursor, segment.end), active);
    if (tail) children.push(tail);

    const style = meta?.paragraphStyle;
    paragraphs.push(
      new Paragraph({
        children,
        alignment: mapAlign(style?.horizontalAlign),
        spacing:
          style?.spaceAbove?.v || style?.spaceBelow?.v
            ? {
                // Univer 的间距单位是磅，docx 是二十分之一磅
                before: style.spaceAbove?.v ? Math.round(style.spaceAbove.v * 20) : undefined,
                after: style.spaceBelow?.v ? Math.round(style.spaceBelow.v * 20) : undefined,
              }
            : undefined,
        indent: style?.indentFirstLine?.v
          ? { firstLine: Math.round(style.indentFirstLine.v * 20) }
          : undefined,
      })
    );
  }

  if (paragraphs.length === 0) paragraphs.push(new Paragraph({ text: '' }));

  const document = new Document({
    creator: 'OpenDocs',
    title,
    sections: [{ properties: {}, children: paragraphs }],
  });

  const blob = await Packer.toBlob(document);
  downloadBlob(blob, safeFileName(title, 'docx'));
}
