import { inject } from 'vitest';
import { setLogLevel } from '../../src/core/logger.js';

process.env.DATABASE_URL = inject('databaseUrl');
setLogLevel('error');
