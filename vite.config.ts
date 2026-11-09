import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/ChordTrainer/',
  plugins: [react()],
  build: {
    // GitHub Pages can serve the /docs folder on master
    outDir: 'docs',
  },
});
