import {
  createId,
  emptyContentFor,
  type DocumentContent,
  type DocumentType,
  type MindmapContent,
  type PptSlide,
  type SlideElement,
} from '../api';

/**
 * 新建文档的模板。
 *
 * 设计约束：模板必须是「可直接落库」的完整内容，而不是编辑器侧的补丁——
 * 用户新建完就带着文件内容，之后任何入口打开都一致。
 *
 * 目前提供真实内容的类型：
 *   - markdown：正文直接是 Markdown 文本
 *   - mindmap：用 markdown 大纲经 @plait-board/markdown-to-drawnix 生成思维导图元素
 *   - ppt：按幻灯片元素结构拼装（与空模板同构）
 *   - image：画布尺寸 / 底色不同
 *
 * word / excel 的内容是 Univer 快照（IDocumentData / IWorkbookData），
 * 手工拼装极易与运行时版本不匹配，因此先只提供「空白模板」，
 * 等能按 Univer 版本做端到端校验后再补。
 */

export const BLANK_TEMPLATE_ID = 'blank';

/** 顶栏、对话框里通用的短类型名（DocumentsPage 里的长标签另有一套） */
export const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  mindmap: '思维导图',
  markdown: 'Markdown',
  word: 'Word',
  excel: 'Excel',
  ppt: '演示文稿',
  image: '图片',
};

export interface DocTemplate {
  id: string;
  name: string;
  /** 模板卡片上的一句话说明 */
  hint?: string;
  /** 新建后的默认标题；留空时用「未命名 + 类型」 */
  title?: string;
  build: () => DocumentContent | Promise<DocumentContent>;
}

function blankTemplate(type: DocumentType): DocTemplate {
  return {
    id: BLANK_TEMPLATE_ID,
    name: '空白文档',
    hint: '从零开始',
    build: () => emptyContentFor(type),
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function markdownTemplate(
  id: string,
  name: string,
  hint: string,
  markdown: string
): DocTemplate {
  return {
    id,
    name,
    hint,
    title: name,
    build: () => ({ type: 'markdown', version: 1, markdown, mindmaps: {} }),
  };
}

// ---------------------------------------------------------------------------
// 思维导图
// ---------------------------------------------------------------------------

/**
 * 用 Markdown 大纲生成思维导图。
 *
 * 约定：outline 的第一个一级标题就是中心主题（解析器把它当成根节点，其余标题/列表项
 * 逐级挂到它下面）。注意解析器无条件读取首个标题，没有标题会直接崩溃，所以这里统一
 * 由模板名生成标题行。
 */
function mindmapTemplate(
  id: string,
  name: string,
  hint: string,
  outline: string
): DocTemplate {
  return {
    id,
    name,
    hint,
    title: name,
    build: async () => {
      const { parseMarkdownToDrawnix } = await import('@plait-board/markdown-to-drawnix');
      const root = parseMarkdownToDrawnix(`# ${name}\n\n${outline}`);
      // 该库输出的是旧版结构：根节点 type 是 legacy 的 'mindmap'，且没有 points。
      // Drawnix 初次渲染时必须能读到根节点坐标，否则子节点初始化会抛
      // 「can not resolve root container g」，所以这里补成当前结构。
      const mind = root as unknown as {
        type: string;
        isRoot?: boolean;
        points?: number[][];
      };
      mind.type = 'mind';
      mind.isRoot = true;
      if (!mind.points) mind.points = [[0, 0]];
      return {
        type: 'mindmap',
        version: 1,
        elements: [root as unknown as MindmapContent['elements'][number]],
        viewport: { zoom: 1 },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 演示文稿
// ---------------------------------------------------------------------------

interface SlideTextOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  bullet?: boolean;
  lineHeight?: number;
}

function slideText(options: SlideTextOptions): SlideElement {
  return {
    id: createId('el'),
    type: 'text',
    fontSize: 32,
    color: '#1b1f24',
    bold: false,
    align: 'left',
    ...options,
  };
}

function slideBar(options: { x: number; y: number; w: number; h: number; fill: string }): SlideElement {
  return { id: createId('el'), type: 'rect', ...options };
}

function slide(elements: SlideElement[], background = '#ffffff'): PptSlide {
  return { id: createId('slide'), background, elements };
}

function pptTemplate(id: string, name: string, hint: string, slides: () => PptSlide[]): DocTemplate {
  return { id, name, hint, title: name, build: () => ({ type: 'ppt', version: 1, slides: slides() }) };
}

// ---------------------------------------------------------------------------
// 图片
// ---------------------------------------------------------------------------

function imageTemplate(
  id: string,
  name: string,
  hint: string,
  width: number,
  height: number,
  background = '#f5f6f8'
): DocTemplate {
  return {
    id,
    name,
    hint,
    title: name,
    build: () => ({ type: 'image', version: 1, width, height, background, layers: [] }),
  };
}

// ---------------------------------------------------------------------------
// 各类型模板清单（第一个必须是空白，新建弹窗默认选中它）
// ---------------------------------------------------------------------------

const TEMPLATES: Record<DocumentType, () => DocTemplate[]> = {
  markdown: () => [
    blankTemplate('markdown'),
    markdownTemplate(
      'md-meeting',
      '会议纪要',
      '议题 / 结论 / 待办',
      `# 会议纪要

- 时间：
- 地点：
- 主持：
- 记录：

## 议题

1. 

## 讨论要点

- 

## 结论与待办

- [ ] 
`
    ),
    markdownTemplate(
      'md-weekly',
      '周报',
      '本周完成 / 下周计划',
      `# 周报（第 周）

## 本周完成

- 

## 进行中

- 

## 风险与阻塞

- 

## 下周计划

- 
`
    ),
    markdownTemplate(
      'md-prd',
      '需求文档',
      '背景 / 目标 / 方案',
      `# 需求文档

## 背景

## 目标与衡量指标

- 

## 方案要点

## 不做的范围

## 排期

| 里程碑 | 时间 | 负责人 |
| --- | --- | --- |
|  |  |  |
`
    ),
  ],

  mindmap: () => [
    blankTemplate('mindmap'),
    mindmapTemplate(
      'mm-project',
      '项目规划',
      '目标 / 范围 / 团队 / 风险',
      `- 目标
  - 里程碑
  - 交付物
- 范围
  - 主要功能
  - 暂不做
- 团队
  - 负责人
  - 协作方
- 风险
  - 技术风险
  - 排期风险`
    ),
    mindmapTemplate(
      'mm-notes',
      '读书笔记',
      '观点 / 论据 / 行动',
      `- 核心观点
- 关键论据
- 我的思考
- 可行动项`
    ),
    mindmapTemplate(
      'mm-brainstorm',
      '头脑风暴',
      '问题 / 解法 / 假设',
      `- 用户问题
- 可能的解法
  - 方案 A
  - 方案 B
- 需要验证的假设`
    ),
  ],

  word: () => [blankTemplate('word')],

  excel: () => [blankTemplate('excel')],

  ppt: () => [
    blankTemplate('ppt'),
    pptTemplate('ppt-report', '项目汇报', '封面 / 进展 / 计划', () => [
      slide([
        slideBar({ x: 0, y: 0, w: 1280, h: 14, fill: '#3370ff' }),
        slideText({
          x: 140,
          y: 280,
          w: 1000,
          h: 110,
          text: '项目汇报',
          fontSize: 64,
          bold: true,
          align: 'center',
        }),
        slideText({
          x: 140,
          y: 410,
          w: 1000,
          h: 60,
          text: '汇报人 / 日期',
          fontSize: 28,
          color: '#86909c',
          align: 'center',
        }),
      ]),
      slide([
        slideText({ x: 100, y: 80, w: 1080, h: 70, text: '本期进展', fontSize: 44, bold: true }),
        slideText({
          x: 100,
          y: 200,
          w: 1080,
          h: 400,
          text: '目标与背景\n关键进展\n数据表现\n遇到的问题',
          fontSize: 30,
          bullet: true,
          lineHeight: 2,
        }),
      ]),
      slide([
        slideText({ x: 100, y: 80, w: 1080, h: 70, text: '下一步计划', fontSize: 44, bold: true }),
        slideText({
          x: 100,
          y: 200,
          w: 1080,
          h: 400,
          text: '下阶段目标\n关键任务与负责人\n需要的支持',
          fontSize: 30,
          bullet: true,
          lineHeight: 2,
        }),
      ]),
      slide([
        slideText({
          x: 140,
          y: 300,
          w: 1000,
          h: 120,
          text: '谢谢观看',
          fontSize: 56,
          bold: true,
          align: 'center',
        }),
      ]),
    ]),
    pptTemplate('ppt-course', '培训课件', '封面 / 目标 / 知识点', () => [
      slide([
        slideBar({ x: 0, y: 0, w: 1280, h: 14, fill: '#0f7b45' }),
        slideText({
          x: 140,
          y: 280,
          w: 1000,
          h: 110,
          text: '课程名称',
          fontSize: 60,
          bold: true,
          align: 'center',
        }),
        slideText({
          x: 140,
          y: 410,
          w: 1000,
          h: 60,
          text: '讲师 / 部门',
          fontSize: 28,
          color: '#86909c',
          align: 'center',
        }),
      ]),
      slide([
        slideText({ x: 100, y: 80, w: 1080, h: 70, text: '课程目标', fontSize: 44, bold: true }),
        slideText({
          x: 100,
          y: 200,
          w: 1080,
          h: 400,
          text: '学完能做什么\n适用范围\n前置知识',
          fontSize: 30,
          bullet: true,
          lineHeight: 2,
        }),
      ]),
      slide([
        slideText({ x: 100, y: 80, w: 1080, h: 70, text: '知识点', fontSize: 44, bold: true }),
        slideText({
          x: 100,
          y: 200,
          w: 1080,
          h: 400,
          text: '概念与原理\n操作演示\n常见问题',
          fontSize: 30,
          bullet: true,
          lineHeight: 2,
        }),
      ]),
    ]),
  ],

  image: () => [
    blankTemplate('image'),
    imageTemplate('img-square', '方图 1:1', '1080 × 1080', 1080, 1080),
    imageTemplate('img-vertical', '竖屏 9:16', '1080 × 1920', 1080, 1920),
    imageTemplate('img-landscape', '横屏 16:9', '1920 × 1080', 1920, 1080),
  ],
};

export function templatesFor(type: DocumentType): DocTemplate[] {
  return TEMPLATES[type]();
}

export function templateById(type: DocumentType, id: string): DocTemplate {
  const list = templatesFor(type);
  return list.find((item) => item.id === id) ?? list[0];
}
