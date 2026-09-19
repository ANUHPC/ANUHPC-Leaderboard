import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || "/",
  build: {
    rollupOptions: {
      output: {
        // One 670 kB chunk meant every visitor downloaded the charting library
        // before the leaderboard table could render, even on pages that show no
        // chart. Splitting on the three heavyweight deps lets the browser cache
        // them across deploys too: they change far less often than our code.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
