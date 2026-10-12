import PptxGenJS from 'pptxgenjs';
import type { PptContent, PptSlide } from '../api';
import { safeFileName } from './download';

async function toDataUrl(url: string): Promise<string | null> {
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

function addTextBlock(
  slide: PptxGenJS.Slide,
  text: string,
  options: PptxGenJS.TextPropsOptions
) {
  if (!text) return;
  slide.addText(text, options);
}

async function buildSlide(pptx: PptxGenJS, slideData: PptSlide) {
  const slide = pptx.addSlide();
  if (slideData.background) slide.background = { color: slideData.background.replace('#', '') };

  const imageDataUrl = slideData.imageUrl ? await toDataUrl(slideData.imageUrl) : null;

  switch (slideData.layout) {
    case 'title':
      addTextBlock(slide, slideData.title, {
        x: 0.6,
        y: 2.2,
        w: 8.8,
        h: 1.4,
        fontSize: 36,
        bold: true,
        align: 'center',
      });
      addTextBlock(slide, slideData.body, { x: 0.6, y: 3.6, w: 8.8, h: 1, fontSize: 18, align: 'center', color: '666666' });
      break;

    case 'two-column':
      addTextBlock(slide, slideData.title, { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 26, bold: true });
      addTextBlock(slide, slideData.body, { x: 0.5, y: 1.4, w: 4.3, h: 4.8, fontSize: 16, valign: 'top' });
      addTextBlock(slide, slideData.bodyRight ?? '', { x: 5.2, y: 1.4, w: 4.3, h: 4.8, fontSize: 16, valign: 'top' });
      break;

    case 'blank':
      if (imageDataUrl) slide.addImage({ data: imageDataUrl, x: 0.5, y: 0.5, w: 9, h: 5 });
      break;

    default:
      addTextBlock(slide, slideData.title, { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 26, bold: true });
      addTextBlock(slide, slideData.body, {
        x: 0.5,
        y: 1.4,
        w: imageDataUrl ? 5.2 : 9,
        h: 4.8,
        fontSize: 16,
        valign: 'top',
      });
      break;
  }

  if (imageDataUrl && slideData.layout !== 'blank') {
    slide.addImage({ data: imageDataUrl, x: 5.9, y: 1.4, w: 3.6, h: 3.6 * 0.66 });
  }
}

export async function exportPptToPptx(content: PptContent, title: string) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'DRAWNIX_16X9', width: 10, height: 5.63 });
  pptx.layout = 'DRAWNIX_16X9';

  for (const slide of content.slides) {
    await buildSlide(pptx, slide);
  }

  await pptx.writeFile({ fileName: safeFileName(title, 'pptx') });
}
