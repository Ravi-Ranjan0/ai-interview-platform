import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {  generateAgentQuestions, meetingsProcessing, generateAndStoreEmbeddings, agentChatHandler, processDocumentEmbeddings, crawlAgentUrls, cancelStaleRooms } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    meetingsProcessing,
    generateAgentQuestions,
    generateAndStoreEmbeddings,
    agentChatHandler,
    processDocumentEmbeddings,
    crawlAgentUrls,
    cancelStaleRooms,
  ],
});