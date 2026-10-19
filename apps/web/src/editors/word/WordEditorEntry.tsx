import { UniverDocEditor } from './UniverDocEditor';
import { WordEditor as TiptapWordEditor, type WordEditorProps } from './WordEditor';

export type { WordEditorProps };

/**
 * Word 编辑器入口：按内容格式分派。
 *
 * - 新文档（engine === 'univer' 或已有 univer 快照）→ Univer Docs
 * - 历史文档（Tiptap 的 ProseMirror JSON，含内嵌思维导图）→ Tiptap
 *
 * 历史文档不自动迁移：ProseMirror 里的表格/图片/内嵌导图在 Univer 中没有等价
 * 结构，强行迁移会丢内容，所以保持只读兼容。
 */
export function WordEditor(props: WordEditorProps) {
  const useUniver = props.content.engine === 'univer' || !!props.content.univer;
  return useUniver ? <UniverDocEditor {...props} /> : <TiptapWordEditor {...props} />;
}
