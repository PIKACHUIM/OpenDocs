import { Workbook, type WorkbookInstance } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import type { Sheet } from '@fortune-sheet/core';
import { useRef, useState } from 'react';
import { createId, type ExcelContent, type ExcelSheet } from '../../api';
import excelStyles from './excel.module.scss';

export interface ExcelEditorProps {
  content: ExcelContent;
  canWrite: boolean;
  onChange: (content: ExcelContent) => void;
}

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
 * Excel 编辑器：直接包一层 Fortune Sheet 的 Workbook 组件。
 *
 * 数据流是「半受控」的：只在挂载时把 content.sheets 转成初始 data，之后完全靠
 * onChange 往外推送——不会把 props.content 重新灌回 Workbook，否则每次自动保存
 * 触发的重渲染都会让表格丢失选区/编辑状态。文档切换时上层会用 `key` 强制整个
 * 编辑器重新挂载，所以这里的「只读初始值」策略是安全的。
 */
export function ExcelEditor({ content, canWrite, onChange }: ExcelEditorProps) {
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
