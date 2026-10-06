import express from 'express';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mediaRoutes from './routes/media.routes.js';
import automationRoutes from './routes/automation.routes.js';
import { toPublicError } from './utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.disable('x-powered-by');
app.use(morgan('dev'));
app.use(express.json({ limit: '32kb' }));

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, service: 'social-video-fetcher' });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/media', mediaRoutes);
app.use('/api/automation', automationRoutes);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ success: false, error: 'API route not found.', code: 'NOT_FOUND' });
    return;
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  const status = error.statusCode || 500;
  if (status >= 500) {
    console.error('[media] server error', error);
  }
  res.status(status).json(toPublicError(error));
});

export default app;
