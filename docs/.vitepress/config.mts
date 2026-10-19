import { defineConfig } from 'vitepress';

/**
 * 文档站配置。
 *
 * ⚠️ 自定义域名需要改三处，保持一致：
 *   1. 下面的 SITE_URL
 *   2. docs/public/CNAME（GitHub Pages 用；Cloudflare Pages 不读它，在控制台配自定义域）
 *   3. 部署平台（Cloudflare Pages / GitHub Pages）的自定义域设置
 */
const SITE_URL = 'https://docs.opendocs.dev';

export default defineConfig({
  lang: 'zh-CN',
  title: 'OpenDocs',
  description: '可自托管的在线文档协作系统：白板、Markdown、Word、Excel、演示文稿',

  // 绑定自定义域后站点部署在根路径；若改为子路径（如 /docs/），这里要改
  base: '/',
  cleanUrls: true,
  lastUpdated: true,

  sitemap: {
    hostname: SITE_URL,
  },

  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'OpenDocs' }],
    ['meta', { name: 'theme-color', content: '#3370ff' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '指南', link: '/guide/features' },
      { text: '部署', link: '/guide/deploy' },
      { text: '开发', link: '/guide/development' },
      { text: '设计', link: '/architecture' },
    ],

    sidebar: [
      {
        text: '使用指南',
        items: [
          { text: '功能说明', link: '/guide/features' },
          { text: '使用教程', link: '/guide/tutorial' },
          { text: '部署方式', link: '/guide/deploy' },
          { text: '开发方式', link: '/guide/development' },
        ],
      },
      {
        text: '设计文档',
        items: [
          { text: '架构设计', link: '/architecture' },
          { text: '设计规范', link: '/design' },
          { text: '需求说明', link: '/requirements' },
        ],
      },
    ],

    outline: { level: [2, 3], label: '本页目录' },

    docFooter: { prev: '上一篇', next: '下一篇' },

    search: { provider: 'local' },

    footer: {
      message: '基于 MIT 协议开源',
      copyright: 'OpenDocs',
    },
  },
});
