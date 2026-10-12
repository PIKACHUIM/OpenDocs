import { Drawnix } from '@drawnix/drawnix';
import { useState } from 'react';
import { createId, type EmbeddedMindmap } from '../../api';
import { Modal } from '../../ui/Modal';
import styles from '../../ui/common.module.scss';

/**
 * Markdown / Word 共用的「内嵌思维导图」编辑弹窗。
 * 直接把一份独立的 Drawnix 元素树存在宿主文档内容里（不是跨文档引用），
 * 这样宿主文档导出/分享时天然带着思维导图数据，不依赖额外的权限联动。
 */
export function createEmbeddedMindmap(): EmbeddedMindmap {
  return { id: createId('mm'), elements: [], viewport: { zoom: 1 } };
}

interface EmbeddedMindmapEditorProps {
  open: boolean;
  mindmap: EmbeddedMindmap;
  canWrite: boolean;
  onClose: () => void;
  onSave: (mindmap: EmbeddedMindmap) => void;
}

export function EmbeddedMindmapEditor({
  open,
  mindmap,
  canWrite,
  onClose,
  onSave,
}: EmbeddedMindmapEditorProps) {
  const [draft, setDraft] = useState(mindmap);

  if (!open) return null;

  return (
    <Modal
      open={open}
      title="编辑内嵌思维导图"
      onClose={onClose}
      wide
      footer={
        <>
          <button className={styles.button} onClick={onClose}>
            取消
          </button>
          {canWrite ? (
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => {
                onSave(draft);
                onClose();
              }}
            >
              保存
            </button>
          ) : null}
        </>
      }
    >
      <div style={{ height: '60vh', position: 'relative', border: '1px solid #e4e7ec', borderRadius: 8 }}>
        <Drawnix
          value={draft.elements}
          viewport={draft.viewport}
          readonly={!canWrite}
          onChange={(value) => {
            setDraft((current) => ({ ...current, elements: value.children, viewport: value.viewport }));
          }}
        />
      </div>
    </Modal>
  );
}
