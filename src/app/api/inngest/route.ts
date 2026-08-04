import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateQuizQuestionBank, gradeQuizAttempt, meetingsProcessing, generateAndStoreEmbeddings, agentChatHandler, processDocumentEmbeddings, crawlAgentUrls, cancelStaleRooms } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    meetingsProcessing,
    generateQuizQuestionBank,
    gradeQuizAttempt,
    generateAndStoreEmbeddings,
    agentChatHandler,
    processDocumentEmbeddings,
    crawlAgentUrls,
    cancelStaleRooms,
  ],
});