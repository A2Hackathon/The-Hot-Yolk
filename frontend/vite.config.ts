import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allows access from network, but user should use localhost for camera
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/assets': 'http://localhost:8000'
    },
    // Enable HTTPS for camera access from network (optional)
    // To use this, you'd need to generate SSL certificates
    // https: false
  }
})
