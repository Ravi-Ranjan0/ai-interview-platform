import { agentsRouter } from '@/modules/agents/server/procedures';
import { createTRPCRouter } from '../init';
import { meetingsRouter } from '@/modules/meetings/server/procedures';
import { conversationsRouter } from '@/modules/conversations/server/procedures';
import { messagesRouter } from '@/modules/chat/server/procedures';
import { documentsRouter } from '@/modules/documents/server/procedures';
import { roomsRouter } from '@/modules/rooms/server/procedures';
import { quizRouter } from '@/modules/quiz/server/procedures';

export const appRouter = createTRPCRouter({
  agents: agentsRouter,
  meetings: meetingsRouter,
  conversations: conversationsRouter,
  messages: messagesRouter,
  documents: documentsRouter,
  rooms: roomsRouter,
  quiz: quizRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;