import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// live.php sender ingen CORS-hoder, så nettleseren får bare lese den via samme opphav.
// /api/live?d=kabin → https://trasmabot.trasma.tech/live.php?d=kabin
const proxy = {
  // Lydfilene til kabinlyden (samme som på nettsiden); ingen CORS der, så de går via oss.
  '/kabinlyd': { target: 'https://trasmabot.trasma.tech', changeOrigin: true },
  '/api/live': {
    target: 'https://trasmabot.trasma.tech',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/live/, '/live.php'),
  },
};

// WebXR krever en sikker kontekst. localhost er det allerede over HTTP; fra Quest over LAN eller
// Tailscale trengs HTTPS (HTTPS=1, selvsignert – godta advarselen én gang i Quest-nettleseren).
const https = process.env.HTTPS === '1';

export default defineConfig({
  plugins: https ? [basicSsl()] : [],
  server: { host: https, proxy },
  preview: { host: https, proxy },
});
