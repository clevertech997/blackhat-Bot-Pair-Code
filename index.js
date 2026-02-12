import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import events from 'events';

// Import routers
import pairRouter from './pair.js';
import qrRouter from './qr.js';

const app = express();

// Increase listeners limit (avoid MaxListeners warning)
events.EventEmitter.defaultMaxListeners = 500;

// Resolve __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

// Middleware (Express built-in instead of body-parser)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

// Start server
app.listen(PORT, () => {
    console.log(`
YouTube: @𝑨𝒏𝒐𝒏𝒚𝒎𝒐𝒖𝒔 𝑼𝒔𝒆
GitHub: @clevertech997

Server running on http://localhost:${PORT}
`);
});

export default app;
