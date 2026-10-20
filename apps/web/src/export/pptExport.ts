import PptxGenJS from 'pptxgenjs';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type PptContent, type PptSlide } from '../api';
import { safeFileName } from './download';

/** 设计稿尺寸（1280×720）→ PPT 英寸（10×5.625） */
const INCH_X = 10 / SLIDE_WIDTH;
const INCH_Y = 5.625 / SLIDE_HEIGHT;
/** 字号换算：设计稿 px → PPT pt */
const PT = (10 * 72) / SLIDE_WIDTH;

function hex(color: string | undefined, fallback = '000000'): string {
  if (!color) return fallback;
  return color.replace('#', '').toUpperCase();
}

async function toDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  try {
    const response = await fetch(url, { credentials: 'include' });
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * 导出 PPTX。
 *
 * 新格式是自由画布：每个元素都带绝对坐标，直接按 1280×720 → 10×5.625 英寸换算，
 * 因此导出结果与编辑器所见基本一致（文字换行可能因字体度量略有差异）。
 * 旧格式（无 elements）按版式粗略还原，保证历史文档仍能导出。
 */
async function buildSlide(pptx: PptxGenJS, data: PptSlide) {
  const slide = pptx.addSlide();
  slide.background = { color: hex(data.background, 'FFFFFF') };

  const elements = data.elements ?? [];
  if (elements.length === 0) {
    // 历史文档兜底
    if (data.title) {
      slide.addText(data.title, {
        x: 0.6,
        y: 2.1,
        w: 8.8,
        h: 1.2,
        fontSize: 36,
        bold: true,
        align: 'center',
      });
    }
    if (data.body) {
      slide.addText(data.body, {
        x: 0.6,
        y: 3.4,
        w: 8.8,
        h: 1.6,
        fontSize: 16,
        align: 'center',
        color: '666666',
      });
    }
    return;
  }

  for (const element of elements) {
    const box = {
      x: element.x * INCH_X,
      y: element.y * INCH_Y,
      w: element.w * INCH_X,
      h: element.h * INCH_Y,
    };

    if (element.type === 'text') {
      const text = element.bullet
        ? element.text
            .split('\n')
            .map((line) => (line.trim() ? `• ${line}` : line))
            .join('\n')
        : element.text;
      slide.addText(text, {
        ...box,
        fontSize: Math.max(8, element.fontSize * PT),
        color: hex(element.color, '1B1F24'),
        bold: element.bold,
        align: element.align,
        valign: 'top',
        margin: 0,
        breakLine: false,
      });
      continue;
    }

    if (element.type === 'table') {
      slide.addTable(
        element.rows.map((row) => row.map((cell) => ({ text: cell }))),
        {
          ...box,
          fontSize: Math.max(8, element.fontSize * PT),
          color: hex(element.color, '1B1F24'),
          border: { type: 'solid', pt: 1, color: hex(element.borderColor, 'D5D8DE') },
          valign: 'middle',
        }
      );
      continue;
    }

    if (
      element.type === 'rect' ||
      element.type === 'ellipse' ||
      element.type === 'triangle' ||
      element.type === 'line'
    ) {
      const shapeType =
        element.type === 'rect'
          ? pptx.ShapeType.rect
          : element.type === 'ellipse'
            ? pptx.ShapeType.ellipse
            : element.type === 'triangle'
              ? pptx.ShapeType.triangle
              : pptx.ShapeType.line;
      slide.addShape(shapeType, {
        ...box,
        fill: { color: hex(element.fill, '3370FF') },
        line: { color: hex(element.fill, '3370FF') },
      });
      continue;
    }

    if (element.type !== 'image') continue;
    const image = await toDataUrl(element.src);
    if (image) slide.addImage({ data: image, ...box });
  }
}

export async function exportPptToPptx(content: PptContent, title: string) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'OPENDOCS_16X9', width: 10, height: 5.625 });
  pptx.layout = 'OPENDOCS_16X9';
  pptx.author = 'OpenDocs';
  pptx.title = title;

  for (const slide of content.slides) {
    await buildSlide(pptx, slide);
  }

  await pptx.writeFile({ fileName: safeFileName(title, 'pptx') });
}
