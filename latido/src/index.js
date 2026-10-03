import { serve } from '@hono/node-server';
import { config } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { startChecker } from './checker.js';

const db = openDb(config.dbPath);
serve({ fetch: buildApp(db).fetch, port: config.port }, () => console.log(`${config.brand} escuchando en :${config.port}`));
if (config.checkerEnabled) startChecker(db);
