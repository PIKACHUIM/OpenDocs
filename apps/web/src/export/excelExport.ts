import ExcelJS from 'exceljs';
import type { ExcelContent } from '../api';
import { downloadBlob, safeFileName } from './download';

interface FortuneCell {
  v?: string | number | boolean;
  m?: string | number;
  bl?: number;
  it?: number;
  fc?: string;
  bg?: string;
  fs?: number;
}

function toArgb(color: string | undefined): string | null {
  if (!color) return null;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const normalized = hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex.padEnd(6, '0').slice(0, 6);
    return `FF${normalized.toUpperCase()}`;
  }
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (match) {
    const [r, g, b] = match.slice(1).map((value) => Number(value).toString(16).padStart(2, '0'));
    return `FF${r}${g}${b}`.toUpperCase();
  }
  return null;
}

/**
 * 导出 Excel：把 Fortune Sheet 的 celldata（Cell 对象原样存在 content.sheets 里）
 * 转成 ExcelJS 的工作簿。覆盖最常用的样式：值、粗体、斜体、字号、字体色、背景色。
 * 公式（f 字段）、条件格式、数据验证等高级特性不在本次范围内。
 */
export async function exportExcelToXlsx(content: ExcelContent, title: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Drawnix';
  workbook.created = new Date();

  for (const sheet of content.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name || 'Sheet', {
      properties: { defaultColWidth: 10 },
    });

    for (const entry of sheet.celldata ?? []) {
      const cellData = entry.v as FortuneCell | null;
      if (!cellData) continue;
      const cell = worksheet.getCell(entry.r + 1, entry.c + 1);
      const value = cellData.v ?? cellData.m;
      if (value === undefined || value === null || value === '') continue;
      cell.value = typeof value === 'boolean' ? value : (value as string | number);

      const fontColorArgb = toArgb(cellData.fc);
      if (cellData.bl || cellData.it || fontColorArgb || cellData.fs) {
        cell.font = {
          bold: !!cellData.bl,
          italic: !!cellData.it,
          size: cellData.fs || undefined,
          color: fontColorArgb ? { argb: fontColorArgb } : undefined,
        };
      }
      const bgArgb = toArgb(cellData.bg);
      if (bgArgb) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      }
    }

    // 粗略按内容长度估算列宽，避免导出的表格所有列都挤在一起
    const widths = new Map<number, number>();
    for (const entry of sheet.celldata ?? []) {
      const cellData = entry.v as FortuneCell | null;
      const text = String(cellData?.m ?? cellData?.v ?? '');
      widths.set(entry.c, Math.max(widths.get(entry.c) ?? 8, Math.min(40, text.length + 2)));
    }
    for (const [colIndex, width] of widths) {
      worksheet.getColumn(colIndex + 1).width = width;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), safeFileName(title, 'xlsx'));
}
