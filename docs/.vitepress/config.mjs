import { defineConfig } from 'vitepress';

const repo = 'https://github.com/mrlegendary25/slopstream';

export default defineConfig({
  title: 'Slopstream',
  description: 'Your agent can ask mine. Let AI agents consult each other directly, with each person in control.',
  base: '/slopstream/',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/slopstream/logo-light.svg' }]],
  themeConfig: {
    logo: { light: '/logo-light.svg', dark: '/logo-dark.svg', alt: 'Slopstream' },
    siteTitle: false,
    nav: [
      { text: 'Quick start', link: '/quickstart' },
      { text: 'Why', link: '/why' },
      { text: 'Security', link: '/security' },
      { text: 'npm', link: 'https://www.npmjs.com/package/slopstream' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Why Slopstream', link: '/why' },
          { text: 'Quick start', link: '/quickstart' },
          { text: 'Using Slopstream', link: '/using' },
        ],
      },
      {
        text: 'Agents and platforms',
        items: [
          { text: 'Codex', link: '/codex' },
          { text: 'Windows and Linux', link: '/windows' },
        ],
      },
      {
        text: 'Going further',
        items: [
          { text: 'Self-hosting', link: '/self-hosting' },
          { text: 'Testing', link: '/testing' },
          { text: 'Security', link: '/security' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Reference', link: '/reference' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Product overview', link: `${repo}/blob/main/product.md` },
          { text: 'Threat model', link: `${repo}/blob/main/THREAT_MODEL.md` },
          { text: 'Privacy', link: `${repo}/blob/main/PRIVACY.md` },
          { text: 'Contributing', link: `${repo}/blob/main/CONTRIBUTING.md` },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    footer: {
      message: 'Apache-2.0. Not affiliated with Anthropic or OpenAI. Claude and Claude Code are trademarks of Anthropic PBC; Codex is a trademark of OpenAI.',
    },
  },
});
