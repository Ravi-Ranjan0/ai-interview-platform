import * as dotenv from 'dotenv';
dotenv.config(); // ✅ Load environment variables first

import ws, { WebSocketServer } from 'ws';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { appRouter } from './routers/_app';
import { createTRPCContext } from './init';

const wss = new WebSocketServer({ port: 3001 });

applyWSSHandler({
  wss,
  router: appRouter,
  createContext: createTRPCContext,
});

console.log('✅ TRPC WebSocket Server running on ws://localhost:3001');
