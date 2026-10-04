import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works when hosted at any sub-path (web game portals).
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // three gets its own chunk (requirement); app code stays in the entry chunk.
        // Vite 8 bundles with rolldown, whose `manualChunks` accepts only the
        // function form (the old object map is not in its types).
        manualChunks: (id: string): string | undefined =>
          id.includes('node_modules/three') ? 'three' : undefined,
      },
    },
  },
});
