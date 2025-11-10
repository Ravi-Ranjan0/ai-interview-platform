import { agentsRouter } from '@/modules/agents/server/procedures';
import { createTRPCRouter } from '../init';
import { meetingsRouter } from '@/modules/meetings/server/procedures';
import { conversationsRouter } from '@/modules/conversations/server/procedures';

export const appRouter = createTRPCRouter({
  agents: agentsRouter,
  meetings: meetingsRouter,
  conversations: conversationsRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;