import { Drawnix } from '@drawnix/drawnix';
import type { MindmapContent } from '../../api';
import styles from '../../ui/common.module.scss';

export interface MindmapEditorProps {
  content: MindmapContent;
  canWrite: boolean;
  onChange: (content: MindmapContent) => void;
}

/**
 * 思维导图编辑器：直接复用项目自带的 Drawnix 白板组件。
 * 外层 mindmapHost 把 Drawnix 的主题变量覆盖成 OpenDocs 的设计 token，
 * 让工具条、弹层、菜单与其它编辑器保持同一套配色与圆角。
 */
export function MindmapEditor({ content, canWrite, onChange }: MindmapEditorProps) {
  return (
    <div className={styles.mindmapHost}>
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
    </div>
  );
}
