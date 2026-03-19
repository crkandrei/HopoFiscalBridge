import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/config';
import logger from './utils/logger';
import { ensureDirectoryExists } from './utils/fileUtils';
import printRoutes from './routes/print.routes';
import { agentService } from './services/agent.service';

// Create Express app
const app = express();

// CORS middleware - allow requests from any origin (since bridge runs locally)
app.use(
  cors({
    origin: '*', // Allow all origins for local bridge
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  })
);

// Middleware for JSON parsing
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'bongo-fiscal-bridge',
    timestamp: new Date().toISOString(),
  });
});

// Mount print routes
app.use('/', printRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn('Route not found', { path: req.path, method: req.method });
  res.status(404).json({
    status: 'error',
    message: 'Route not found',
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
});

/**
 * Initialize application
 * Ensures all required directories exist
 */
async function initializeApp(): Promise<void> {
  logger.info('Initializing application...');

  const directories = [
    config.ecrBridge.bonPath,
    config.ecrBridge.bonOkPath,
    config.ecrBridge.bonErrPath,
  ];

  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 3000;

  for (const dir of directories) {
    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (ensureDirectoryExists(dir)) {
        logger.info(`Directory ready: ${dir}`);
        success = true;
        break;
      }
      logger.warn(`Directory not ready (attempt ${attempt}/${MAX_RETRIES}): ${dir}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    if (!success) {
      logger.error(`Failed to initialize directory after ${MAX_RETRIES} attempts: ${dir}`);
      process.exit(1);
    }
  }

  const modeLabel = config.bridgeMode === 'live' ? 'LIVE' : 'TEST';
  const modeDescription = config.bridgeMode === 'live' ? 'Fiscal receipts' : 'Non-fiscal test receipts';
  logger.info(`Bridge mode: ${modeLabel} - ${modeDescription}`);
  logger.info('Application initialized successfully (v1.0.2)');
}

/**
 * Start the server
 */
async function startServer(): Promise<void> {
  await initializeApp();

  const server = app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`, {
      port: config.port,
      env: process.env.NODE_ENV || 'development',
      bridgeMode: config.bridgeMode.toUpperCase(),
    });
  });

  agentService.start();

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    agentService.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    agentService.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
}

// Start the server
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;

