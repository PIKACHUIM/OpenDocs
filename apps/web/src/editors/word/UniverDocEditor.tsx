import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, merge } from '@univerjs/presets';
import type { IDocumentData } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import zhCN from '@univerjs/preset-docs-core/locales/zh-CN';
import enUS from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import type { WordEditorProps } from './WordEditor';

/**
 * 新版 Word 编辑器：Univer Docs。
 *
 * 内容以 IDocumentData 快照整体存进 `content.univer`；历史文档（没有 univer 字段）
 * 仍由 Tiptap 打开，避免富文本与内嵌导图丢失。
 *
 * header/footer 关闭：Univer 自带的品牌栏不显示，外壳统一由 DocumentShell 提供。
 */
export function UniverDocEditor({ content, canWrite, onChange }: WordEditorProps) {
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
      presets: [UniverDocsCorePreset({ container: host, header: false, footer: false })],
    });

    const snapshot = contentRef.current.univer as Partial<IDocumentData> | undefined;
    const document = univerAPI.createDocument(
      snapshot ?? {
        id: `opendocs_${Date.now().toString(36)}`,
        title: contentRef.current.doc ? '文档' : '未命名文档',
      }
    );

    const editable = document as unknown as { setEditable?: (value: boolean) => void };
    if (!canWrite && typeof editable.setEditable === 'function') {
      editable.setEditable(false);
    }

    // FDocument 没有 onCommandExecuted，这里用「定时比对快照」的方式感知变更：
    // 序列化结果与上次不同才向上推送，避免无意义的自动保存请求。
    let lastSnapshot = JSON.stringify(snapshot ?? null);
    const timer = window.setInterval(() => {
      try {
        const next = document.save();
        const serialized = JSON.stringify(next);
        if (serialized === lastSnapshot) return;
        lastSnapshot = serialized;
        onChangeRef.current({ ...contentRef.current, univer: next });
      } catch {
        // 编辑器尚在初始化或已销毁时忽略
      }
    }, 1200);

    return () => {
      window.clearInterval(timer);
      try {
        const final = document.save();
        if (JSON.stringify(final) !== lastSnapshot) {
          onChangeRef.current({ ...contentRef.current, univer: final });
        }
        univer.dispose();
      } catch {
        // 卸载竞态下 Univer 可能抛错，忽略
      }
    };
  }, [canWrite]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />;
}
