# Enable HTTPS for Camera Access from Network

If you need to access the app from other devices on your network, you need HTTPS.

## Quick Setup (Development)

### Option 1: Use mkcert (Recommended for local development)

```bash
# Install mkcert (one time)
# Windows (using Chocolatey):
choco install mkcert

# Mac (using Homebrew):
brew install mkcert

# Linux:
# Follow instructions at https://github.com/FiloSottile/mkcert

# Create local CA
mkcert -install

# Generate certificates
cd frontend
mkcert localhost 127.0.0.1 10.5.151.115 0.0.0.0

# This creates localhost+3.pem and localhost+3-key.pem
```

Then update `vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    https: {
      key: fs.readFileSync('./localhost+3-key.pem'),
      cert: fs.readFileSync('./localhost+3.pem'),
    },
    proxy: {
      '/api': 'http://localhost:8000',
      '/assets': 'http://localhost:8000'
    }
  }
})
```

Then access via: `https://10.5.151.115:3000` (accept the security warning - it's safe for local development)

### Option 2: Use localhost on the same machine

Just use `http://localhost:3000` - this is the simplest solution!
