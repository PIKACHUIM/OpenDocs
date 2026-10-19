import { Workbook, type WorkbookInstance } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import type { Sheet } from '@fortune-sheet/core';
import { useRef, useState } from 'react';
import { createId, type ExcelContent, type ExcelSheet } from '../../api';
import excelStyles from './excel.module.scss';
import type { ExcelEditorProps } from './types';

function toFortuneSheets(sheets: ExcelSheet[]): Sheet[] {
  return sheets.map((sheet, index) => ({
    id: sheet.id,
    name: sheet.name,
    celldata: sheet.celldata as Sheet['celldata'],
    row: sheet.row,
    column: sheet.column,
    order: sheet.order ?? index,
    status: index === 0 ? 1 : 0,
  }));
}

function fromFortuneSheets(sheets: Sheet[]): ExcelSheet[] {
  return sheets.map((sheet, index) => ({
    id: sheet.id || createId('sheet'),
    name: sheet.name || `Sheet${index + 1}`,
    celldata: (sheet.celldata ?? []) as ExcelSheet['celldata'],
    row: sheet.row ?? 84,
    column: sheet.column ?? 26,
    order: sheet.order ?? index,
  }));
}

/**
 * 旧版 Excel 编辑器（FortuneSheet）。
 *
 * 只用于打开「已有 celldata 的历史文档」——这类文档如果直接交给 Univer，
 * 会因为格式不同而看起来像数据丢了。新文档一律走 UniverSheetEditor。
 *
 * 数据流是「半受控」的：只在挂载时灌入初始值，之后靠 onChange 往外推，
 * 避免每次自动保存的重渲染冲掉选区与编辑状态。
 */
export function FortuneSheetEditor({ content, canWrite, onChange }: ExcelEditorProps) {
  const [initialData] = useState(() => toFortuneSheets(content.sheets));
  const workbookRef = useRef<WorkbookInstance>(null);
  const timerRef = useRef<number | null>(null);

  const scheduleChange = (sheets: Sheet[]) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onChange({ ...content, sheets: fromFortuneSheets(sheets) });
    }, 600);
  };

  return (
    <div className={excelStyles.wrap}>
      <Workbook
        ref={workbookRef}
        data={initialData}
        lang="zh"
        allowEdit={canWrite}
        showToolbar={canWrite}
        showFormulaBar={canWrite}
        onChange={scheduleChange}
      />
    </div>
  );
}
