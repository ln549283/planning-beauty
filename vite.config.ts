import { defineConfig } from 'vite'

// Keep the demo engine's WebAssembly and extension URLs relative to its package in development.
export default defineConfig({
  optimizeDeps: {
    exclude: [
      '@electric-sql/pglite',
      '@electric-sql/pglite/contrib/btree_gist',
    ],
  },
})
