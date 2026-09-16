import { defineConfig } from 'vite';
export default defineConfig({ base: './', resolve: {preserveSymlinks: true}, server: { port: 5173, strictPort: true } });
