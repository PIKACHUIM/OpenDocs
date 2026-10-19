import {
  AlignmentType,
  Document as DocxDocument,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import type { WordContent } from '../api';
import { downloadBlob, safeFileName } from './download';
import { exportElementToPdf } from './htmlToPdf';

/**
 * 把 Tiptap 的 ProseMirror JSON 转成 docx 文档。
 * 覆盖我们编辑器工具栏实际暴露的节点/标记：标题、段落（含对齐）、粗体/斜体/
 * 下划线/删除线/高亮、有序/无序列表、引用、表格、图片、分隔线、内嵌思维导图占位。
 */
interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

const ALIGN_MAP: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const RASTER_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp']);

function textRunsFromInline(nodes: PMNode[] = []): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      runs.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (node.type !== 'text' || !node.text) continue;
    const marks = node.marks ?? [];
    const highlight = marks.find((mark) => mark.type === 'highlight');
    const color = typeof highlight?.attrs?.color === 'string' ? highlight.attrs.color.replace('#', '') : undefined;
    runs.push(
      new TextRun({
        text: node.text,
        bold: marks.some((mark) => mark.type === 'bold'),
        italics: marks.some((mark) => mark.type === 'italic'),
        strike: marks.some((mark) => mark.type === 'strike'),
        underline: marks.some((mark) => mark.type === 'underline') ? {} : undefined,
        shading: color ? { type: ShadingType.CLEAR, fill: color } : undefined,
      })
    );
  }
  return runs.length > 0 ? runs : [new TextRun('')];
}

/** 把任意图片字节统一转成 PNG：docx 的 ImageRun 只认 png/jpg/gif/bmp，webp/svg 需要先转码 */
async function toRasterPng(buffer: ArrayBuffer, contentType: string): Promise<ArrayBuffer> {
  const extension = contentType.split('/')[1]?.split('+')[0] ?? '';
  if (RASTER_TYPES.has(extension)) return buffer;

  const bitmap = await createImageBitmap(new Blob([buffer], { type: contentType }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return buffer;
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? blob.arrayBuffer() : buffer;
}

async function imageParagraph(src: string): Promise<Paragraph> {
  try {
    const response = await fetch(src, { credentials: 'include' });
    const rawBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') ?? 'image/png';
    const buffer = await toRasterPng(rawBuffer, contentType);
    const maxWidth = 440;
    const bitmap = await createImageBitmap(new Blob([buffer]));
    const ratio = bitmap.height / bitmap.width;
    return new Paragraph({
      children: [
        new ImageRun({
          type: 'png',
          data: buffer,
          transformation: { width: maxWidth, height: Math.round(maxWidth * ratio) },
        }),
      ],
    });
  } catch {
    return new Paragraph({ children: [new TextRun({ text: '[图片加载失败]', italics: true })] });
  }
}

function listParagraphs(node: PMNode, ordered: boolean, depth = 0): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const item of node.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') {
        paragraphs.push(
          new Paragraph({
            children: textRunsFromInline(child.content),
            bullet: ordered ? undefined : { level: depth },
            numbering: ordered ? { reference: 'word-ordered-list', level: depth } : undefined,
          })
        );
      } else if (child.type === 'bulletList') {
        paragraphs.push(...listParagraphs(child, false, depth + 1));
      } else if (child.type === 'orderedList') {
        paragraphs.push(...listParagraphs(child, true, depth + 1));
      }
    }
  }
  return paragraphs;
}

async function tableFromNode(node: PMNode): Promise<Table> {
  const rows: TableRow[] = [];
  for (const row of node.content ?? []) {
    const cells: TableCell[] = [];
    for (const cell of row.content ?? []) {
      const cellChildren: Array<Paragraph | Table> = [];
      for (const block of cell.content ?? []) {
        cellChildren.push(...(await blockToParagraphs(block)));
      }
      cells.push(new TableCell({ children: cellChildren.length ? cellChildren : [new Paragraph('')] }));
    }
    rows.push(new TableRow({ children: cells }));
  }
  return new Table({ rows });
}

async function blockToParagraphs(node: PMNode): Promise<Array<Paragraph | Table>> {
  const textAlign = typeof node.attrs?.textAlign === 'string' ? (node.attrs.textAlign as string) : undefined;

  switch (node.type) {
    case 'paragraph':
      return [
        new Paragraph({
          children: textRunsFromInline(node.content),
          alignment: textAlign ? ALIGN_MAP[textAlign] : undefined,
        }),
      ];
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      const headingKey = `HEADING_${level}` as keyof typeof HeadingLevel;
      return [
        new Paragraph({
          heading: HeadingLevel[headingKey],
          children: textRunsFromInline(node.content),
          alignment: textAlign ? ALIGN_MAP[textAlign] : undefined,
        }),
      ];
    }
    case 'blockquote': {
      const inner: Array<Paragraph | Table> = [];
      for (const child of node.content ?? []) inner.push(...(await blockToParagraphs(child)));
      return inner;
    }
    case 'bulletList':
      return listParagraphs(node, false);
    case 'orderedList':
      return listParagraphs(node, true);
    case 'horizontalRule':
      return [new Paragraph({ children: [new TextRun('—'.repeat(24))] })];
    case 'image':
      return [await imageParagraph(String(node.attrs?.src ?? ''))];
    case 'mindmapEmbed':
      return [new Paragraph({ children: [new TextRun({ text: '🧠 [内嵌思维导图]', italics: true })] })];
    case 'table':
      return [await tableFromNode(node)];
    default:
      return [];
  }
}

export async function exportWordToDocx(content: WordContent, title: string) {
  // 新文档由 Univer 编辑，导出走 Univer 快照；历史文档继续用 ProseMirror 转换
  if (content.univer) {
    const { exportUniverDocToDocx } = await import('./univerDocExport');
    await exportUniverDocToDocx(content, title);
    return;
  }

  const root = content.doc as unknown as PMNode;
  const children: Array<Paragraph | Table> = [];
  for (const block of root.content ?? []) {
    children.push(...(await blockToParagraphs(block)));
  }

  const docxDocument = new DocxDocument({
    numbering: {
      config: [
        {
          reference: 'word-ordered-list',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  });

  const blob = await Packer.toBlob(docxDocument);
  downloadBlob(blob, safeFileName(title, 'docx'));
}

export async function exportWordToPdf(title: string) {
  const element = document.querySelector<HTMLElement>('[data-export-target="word-page"]');
  if (!element) throw new Error('未找到可导出的内容');
  await exportElementToPdf(element, title);
}
