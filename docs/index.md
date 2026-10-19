---
layout: home

hero:
  name: OpenDocs
  text: 可自托管的在线文档协作系统
  tagline: 白板、Markdown、Word、Excel、演示文稿，一套账号、一套目录、一次部署。
  actions:
    - theme: brand
      text: 开始使用
      link: /guide/tutorial
    - theme: alt
      text: 部署到自己的账号
      link: /guide/deploy
    - theme: alt
      text: 功能说明
      link: /guide/features

features:
  - title: 五类文档，一处管理
    details: 白板/思维导图、Markdown、Word、Excel、演示文稿共用同一套账号、目录与分享体系，不再为每种文档维护一套系统。
  - title: 纯静态前端 + 边缘后端
    details: 前端产物是静态文件，后端是可部署到 Cloudflare Workers 或 EdgeOne 的 Hono 应用，没有常驻服务器，部署成本接近零。
  - title: 未登录也能用
    details: 首页可直接试用任意编辑器，内容只存在浏览器；登录后一键保存到账号，试用内容不浪费。
  - title: 数据留在自己账号下
    details: 元数据存 Cloudflare D1，文档正文与图片存 R2 或 EdgeOne Blob，不经过任何第三方服务。
  - title: 邀请制注册
    details: 可关闭自助注册，或开启邀请码：单码可用次数、有效期、启停，名额扣减并发安全。
  - title: 分享与协作
    details: 链接分享支持只读 / 可编辑，未登录用户也能通过链接协作；也可按邮箱邀请协作者并指定角色。
---
