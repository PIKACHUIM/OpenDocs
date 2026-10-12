import { Drawnix } from '@drawnix/drawnix';
import type { MindmapContent } from '../../api';

export interface MindmapEditorProps {
  content: MindmapContent;
  canWrite: boolean;
  onChange: (content: MindmapContent) => void;
}

/** 思维导图编辑器：直接复用项目自带的 Drawnix 白板组件 */
export function MindmapEditor({ content, canWrite, onChange }: MindmapEditorProps) {
  return (
    <Drawnix
      value={content.elements}
      viewport={content.viewport}
      theme={content.theme}
      readonly={!canWrite}
      onChange={(value) => {
        onChange({
          type: 'mindmap',
          version: content.version,
          elements: value.children,
          viewport: value.viewport,
          theme: value.theme,
        });
      }}
    />
  );
}
