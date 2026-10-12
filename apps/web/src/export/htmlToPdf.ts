import { jsPDF } from 'jspdf';
import { html2canvas } from 'html2canvas-pro';
import { downloadBlob, safeFileName } from './download';

/**
 * 把一个已经渲染在页面上的 DOM 节点整体转成 PDF（A4，按高度分页）。
 * 用于 Markdown / Word 的「生成 PDF」——直接复用当前编辑器里真实渲染好的 HTML，
 * 不需要另起一套离屏渲染逻辑。
 */
export async function exportElementToPdf(element: HTMLElement, title: string): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
  });

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const imageWidth = pageWidth;
  const imageHeight = (canvas.height * imageWidth) / canvas.width;

  // 按 A4 高度把长画布切成多页；每页从源 canvas 裁出对应的像素条带，避免内容跨页断裂时整体失真
  const pxPerPtY = canvas.height / imageHeight;
  const pageHeightPx = Math.floor(pageHeight * pxPerPtY);

  let renderedHeightPx = 0;
  let pageIndex = 0;

  while (renderedHeightPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedHeightPx);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeightPx;
    const ctx = sliceCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(canvas, 0, renderedHeightPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
    }

    if (pageIndex > 0) pdf.addPage();
    const sliceHeightPt = (sliceHeightPx / canvas.height) * imageHeight;
    pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 0, 0, imageWidth, sliceHeightPt);

    renderedHeightPx += sliceHeightPx;
    pageIndex += 1;
  }

  downloadBlob(pdf.output('blob'), safeFileName(title, 'pdf'));
}
