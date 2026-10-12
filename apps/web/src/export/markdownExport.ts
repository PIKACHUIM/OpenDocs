import type { MarkdownContent } from '../api';
import { downloadText, safeFileName } from './download';
import { exportElementToPdf } from './htmlToPdf';

/** 导出原始 Markdown 源码（内嵌思维导图的占位符 `[[mindmap:id]]` 原样保留） */
export function exportMarkdownSource(content: MarkdownContent, title: string) {
  downloadText(content.markdown, safeFileName(title, 'md'), 'text/markdown;charset=utf-8');
}

/**
 * 导出 PDF：直接截取当前编辑器里已经渲染好的预览 DOM（见 markdown.module.scss 的
 * `.preview`，通过 data-export-target 定位），保证 PDF 与屏幕上看到的渲染结果一致，
 * 内嵌思维导图会以预览里的卡片占位样式出现在 PDF 中。
 */
export async function exportMarkdownToPdf(title: string) {
  const element = document.querySelector<HTMLElement>('[data-export-target="markdown-preview"]');
  if (!element) throw new Error('未找到可导出的预览内容');
  await exportElementToPdf(element, title);
}
