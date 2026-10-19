import type { ExcelContent } from '../../api';
import { FortuneSheetEditor } from './FortuneSheetEditor';
import { UniverSheetEditor } from './UniverSheetEditor';
import type { ExcelEditorProps } from './types';

export type { ExcelEditorProps };

/**
 * Excel 编辑器入口：按内容格式分派。
 *
 * - 有 Univer 快照（新文档）→ Univer，完整公式与格式能力
 * - 只有 FortuneSheet 的 celldata（历史文档）→ 旧编辑器，保证旧数据能正常打开
 *
 * 历史文档不会自动迁移：迁移需要把 celldata 转成 Univer 的 cellData，
 * 且样式/合并单元格存在丢失风险，留到有明确需求时再做。
 */
export function ExcelEditor(props: ExcelEditorProps) {
  return hasLegacyData(props.content) ? (
    <FortuneSheetEditor {...props} />
  ) : (
    <UniverSheetEditor {...props} />
  );
}

function hasLegacyData(content: ExcelContent): boolean {
  if (content.univer) return false;
  return (content.sheets ?? []).some((sheet) => (sheet.celldata?.length ?? 0) > 0);
}
