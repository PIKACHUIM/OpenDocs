import PptxGenJS from 'pptxgenjs';
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type PptContent,
  type PptSlide,
  type SlideShapeElement,
} from '../api';
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

  // 形状映射用实例上的枚举构造（PptxGenJS 的 ShapeType 挂在实例上）
  const shapeMap: Record<string, PptxGenJS.ShapeType> = {
    rect: pptx.ShapeType.rect,
    roundRect: pptx.ShapeType.roundRect,
    ellipse: pptx.ShapeType.ellipse,
    triangle: pptx.ShapeType.triangle,
    diamond: pptx.ShapeType.diamond,
    pentagon: pptx.ShapeType.pentagon,
    chevron: pptx.ShapeType.chevron,
    star: pptx.ShapeType.star5,
    line: pptx.ShapeType.line,
  };

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

    if (element.type === 'chart') {
      // 图表用原生图表导出，保证在 PowerPoint 里仍可编辑数据
      const chartTypeMap = {
        column: pptx.ChartType.bar,
        bar: pptx.ChartType.bar,
        line: pptx.ChartType.line,
        area: pptx.ChartType.area,
        pie: pptx.ChartType.pie,
        ring: pptx.ChartType.doughnut,
        radar: pptx.ChartType.radar,
        scatter: pptx.ChartType.scatter,
      } as const;
      slide.addChart(
        chartTypeMap[element.chartType] ?? pptx.ChartType.bar,
        element.data.series.map((item) => ({
          name: item.name,
          labels: element.data.labels,
          values: item.values,
        })),
        {
          ...box,
          barDir: element.chartType === 'bar' ? 'bar' : 'col',
          showLegend: element.showLegend,
          showValue: element.showValue,
          chartColors: element.themeColors.map((color) => hex(color, '3370FF')),
          title: element.title || undefined,
          showTitle: !!element.title,
        }
      );
      continue;
    }

    if (element.type === 'latex') {
      // pptx 无原生公式，导出为文本；坐标与字号保持一致
      slide.addText(element.latex, {
        ...box,
        fontSize: Math.max(8, element.fontSize * PT),
        color: hex(element.color, '1B1F24'),
        align: 'center',
        valign: 'middle',
        italic: true,
        fontFace: 'Cambria Math',
      });
      continue;
    }

    if (element.type === 'video' || element.type === 'audio' || element.type === 'iframe') {
      // 媒体与网页在 pptx 里无法逐帧还原，导出为带链接的说明框，避免信息丢失
      const label =
        element.type === 'video'
          ? `[视频] ${element.src}`
          : element.type === 'audio'
            ? `[音频] ${element.src}`
            : `[网页] ${element.src}`;
      slide.addText(label, {
        ...box,
        fontSize: 10,
        color: '4E5969',
        align: 'left',
        valign: 'middle',
        fill: { color: 'F2F3F5' },
        hyperlink: { url: element.src },
      });
      continue;
    }

    if (shapeMap[element.type as string]) {
      const shape = element as SlideShapeElement;
      slide.addShape(shapeMap[shape.type as string], {
        ...box,
        fill: shape.type === 'line' ? { color: hex(shape.fill, '3370FF') } : { color: hex(shape.fill, '3370FF') },
        line:
          shape.type === 'line'
            ? { color: hex(shape.fill, '3370FF'), width: (shape.lineWidth ?? 4) * 0.75 }
            : shape.lineColor
              ? { color: hex(shape.lineColor, '1B1F24'), width: (shape.lineWidth ?? 1) * 0.75 }
              : { color: hex(shape.fill, '3370FF') },
      });
      continue;
    }

    if (element.type !== 'image') continue;
    const image = await toDataUrl(element.src);
    if (image) {
      slide.addImage({
        data: image,
        ...box,
        rounding: element.radius ? true : false,
      });
    }
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
