import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  build: {
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'editor', test: /node_modules[\\/](?:@codemirror|@lezer)[\\/]/ }],
        },
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'kontur-csp',
      apply: 'build',
      transformIndexHtml() {
        return [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'",
          },
          injectTo: 'head-prepend',
        }]
      },
    },
  ],
})
