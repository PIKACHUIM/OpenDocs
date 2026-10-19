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

/** Univer 工作簿快照里我们导出时用到的字段 */
interface UniverCell {
  v?: unknown;
  f?: string;
}

interface UniverSheet {
  id: string;
  name?: string;
  cellData?: Record<string, Record<string, UniverCell>>;
  mergeData?: Array<{
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
  }>;
}

interface UniverWorkbook {
  sheetOrder?: string[];
  sheets?: Record<string, UniverSheet>;
}

/**
 * 导出 Excel。
 *
 * 两种内容格式都支持：
 * - Univer 文档（新）→ 读 IWorkbookData，导出值与公式、合并单元格
 * - FortuneSheet 文档（历史）→ 读 celldata，额外还原常用样式
 *
 * 样式（字体/底色/数字格式）在 Univer 分支里暂不还原：快照中的样式是索引引用，
 * 需要同时解析 workbook.styles 表，收益不高，先保证数据与公式不丢。
 */
export async function exportExcelToXlsx(content: ExcelContent, title: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OpenDocs';
  workbook.created = new Date();

  const snapshot = content.univer as UniverWorkbook | undefined;
  if (snapshot?.sheets && Object.keys(snapshot.sheets).length > 0) {
    const order = snapshot.sheetOrder ?? Object.keys(snapshot.sheets);
    for (const sheetId of order) {
      const sheet = snapshot.sheets[sheetId];
      if (!sheet) continue;
      const worksheet = workbook.addWorksheet(sheet.name || 'Sheet');
      const cellData = sheet.cellData ?? {};

      for (const [rowKey, row] of Object.entries(cellData)) {
        for (const [colKey, cell] of Object.entries(row ?? {})) {
          if (!cell) continue;
          const r = Number(rowKey) + 1;
          const c = Number(colKey) + 1;
          const target = worksheet.getCell(r, c);
          const value = cell.v;
          if (cell.f) {
            target.value = {
              formula: cell.f.startsWith('=') ? cell.f.slice(1) : cell.f,
              result: typeof value === 'number' || typeof value === 'string' ? value : undefined,
            } as ExcelJS.CellFormulaValue;
            continue;
          }
          if (value === undefined || value === null || value === '') continue;
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            target.value = value;
          }
        }
      }

      for (const merge of sheet.mergeData ?? []) {
        worksheet.mergeCells(
          merge.startRow + 1,
          merge.startColumn + 1,
          merge.endRow + 1,
          merge.endColumn + 1
        );
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      safeFileName(title, 'xlsx')
    );
    return;
  }

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
