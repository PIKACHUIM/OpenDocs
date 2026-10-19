import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, merge } from '@univerjs/presets';
import type { IWorkbookData } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import enUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { ExcelEditorProps } from './types';

/**
 * 新版 Excel 编辑器：Univer。
 *
 * 相比 FortuneSheet，Univer 提供完整的公式引擎、数字格式、条件格式、数据校验、
 * 冻结、筛选等能力，接近线上表格产品。内容以 IWorkbookData 快照整体存进
 * `content.univer`，与旧格式互不干扰。
 *
 * 注意：Univer 自己管理 DOM 与渲染，React 只负责挂载容器和回收实例，
 * 所以这里刻意不做「受控回灌」——把 props 写回实例会让光标与选区每次保存都重置。
 */
export function UniverSheetEditor({ content, canWrite, onChange }: ExcelEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: {
        [LocaleType.ZH_CN]: merge({}, zhCN),
        [LocaleType.EN_US]: merge({}, enUS),
      },
      presets: [UniverSheetsCorePreset({ container: host })],
    });

    const snapshot = contentRef.current.univer as Partial<IWorkbookData> | undefined;
    const workbook = univerAPI.createWorkbook(
      snapshot ?? {
        id: `opendocs_${Date.now().toString(36)}`,
        name: 'Sheet1',
        sheetOrder: ['sheet-01'],
        sheets: {
          'sheet-01': {
            id: 'sheet-01',
            name: 'Sheet1',
            rowCount: 200,
            columnCount: 30,
            cellData: {},
          },
        },
      }
    );

    if (!canWrite) workbook.setEditable(false);

    const disposable = workbook.onCommandExecuted(() => {
      onChangeRef.current({ ...contentRef.current, univer: workbook.save() });
    });

    return () => {
      try {
        disposable.dispose();
        univer.dispose();
      } catch {
        // Univer 在卸载竞态下偶发抛错，忽略即可
      }
    };
  }, [canWrite]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />;
}
