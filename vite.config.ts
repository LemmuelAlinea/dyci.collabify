import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `host: true` binds the dev server to every interface rather than just
  // localhost, so the app can be opened from a phone on the same Wi-Fi. Dev
  // only — it has no bearing on the production build.
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      output: {
        /**
         * Libraries change on their own schedule, so they are cached on their
         * own. Without this every deploy — a word of copy, a colour — hands
         * every returning student the whole of React, Supabase and Motion
         * again, because one file's hash changes the file they all live in.
         *
         * Split by what changes together rather than by size: `motion` is only
         * needed once something animates, and `supabase` only after sign-in.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          motion: ['motion/react'],
        },
      },
    },
  },
})
