import { pgTable, text, timestamp, boolean, integer, pgEnum, AnyPgColumn, index, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const user = pgTable("user", {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').$defaultFn(() => false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').$defaultFn(() => /* @__PURE__ */ new Date()).notNull(),
  updatedAt: timestamp('updated_at').$defaultFn(() => /* @__PURE__ */ new Date()).notNull()
  });

export const session = pgTable("session", {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(()=> user.id, { onDelete: 'cascade' })
}, (table) => [
  index("session_user_id_idx").on(table.userId),
]);


export const account = pgTable("account", {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(()=> user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
}, (table) => [
  index("account_user_id_idx").on(table.userId),
]);

export const verification = pgTable("verification", {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').$defaultFn(() => /* @__PURE__ */ new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => /* @__PURE__ */ new Date())
});

export const urlsStatus = pgEnum("urls_status", [
  "idle",
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const agents = pgTable("agents", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  name: text('name').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  instructions: text('instructions').notNull(),
  urls: text('urls'),  // JSON-stringified array of URLs
  urlsStatus: urlsStatus('urls_status').notNull().default("idle"),
  urlsUpdatedAt: timestamp('urls_updated_at'),
  urlsError: text('urls_error'),
  lastResponse: text('last_response'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index("agents_user_id_idx").on(table.userId),
]);


export const meetingStatus = pgEnum("meeting_status", ["upcoming","active", "processing", "completed", "cancelled"]);

export const meetings = pgTable("meetings", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  name: text('name').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  status: meetingStatus('status').notNull().default("upcoming"),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  transcriptUrl: text('transcript_url'),
  recordingUrl: text('recording_url'),
  summary: text('summary'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index("meetings_user_id_idx").on(table.userId),
  index("meetings_agent_id_idx").on(table.agentId),
  index("meetings_status_idx").on(table.status),
]);

export const conversations = pgTable("conversations", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  title: text('title').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index("conversations_user_id_idx").on(table.userId),
  index("conversations_agent_id_idx").on(table.agentId),
]);

export const messages = pgTable("messages", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  sender: text('sender').notNull(), // 'user' or 'agent'
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON string; agent replies carry retrieval sources for debug/test UIs
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index("messages_conversation_id_idx").on(table.conversationId),
  index("messages_user_id_idx").on(table.userId),
]);

export const documentStatus = pgEnum("document_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const documents = pgTable("documents", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  fileUrl: text('file_url').notNull(),
  fileSize: integer('file_size'),
  mimeType: text('mime_type').notNull(),
  status: documentStatus('status').notNull().default("pending"),
  chunkCount: integer('chunk_count'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index("documents_agent_id_idx").on(table.agentId),
  index("documents_user_id_idx").on(table.userId),
  index("documents_status_idx").on(table.status),
]);

export const roomStatus = pgEnum("room_status", ["open", "scheduled", "completed", "cancelled"]);

export const rooms = pgTable("rooms", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  topic: text('topic').notNull(),
  createdBy: text('created_by').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: roomStatus('status').notNull().default("open"),
  scheduledAt: timestamp('scheduled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index("rooms_status_idx").on(table.status),
  index("rooms_created_by_idx").on(table.createdBy),
]);

export const roomMembers = pgTable("room_members", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, (table) => [
  index("room_members_room_id_idx").on(table.roomId),
  index("room_members_user_id_idx").on(table.userId),
  uniqueIndex("room_members_room_user_uq").on(table.roomId, table.userId),
]);

export const roomMessages = pgTable("room_messages", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  editedAt: timestamp('edited_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index("room_messages_room_id_idx").on(table.roomId),
]);

export const roomTimeSlots = pgTable("room_time_slots", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  proposedBy: text('proposed_by').notNull().references(() => user.id, { onDelete: 'cascade' }),
  slotTime: timestamp('slot_time').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index("room_time_slots_room_id_idx").on(table.roomId),
]);

export const roomTimeSlotVotes = pgTable("room_time_slot_votes", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  slotId: text('slot_id').notNull().references(() => roomTimeSlots.id, { onDelete: 'cascade' }),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index("room_time_slot_votes_slot_id_idx").on(table.slotId),
  uniqueIndex("room_time_slot_votes_room_user_uq").on(table.roomId, table.userId),
]);

export const roomCompletions = pgTable("room_completions", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  completedAt: timestamp('completed_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex("room_completions_room_user_uq").on(table.roomId, table.userId),
]);

export const roomBonusAwards = pgTable("room_bonus_awards", {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  points: integer('points').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index("room_bonus_awards_user_id_idx").on(table.userId),
]);
