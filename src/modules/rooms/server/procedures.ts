import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  ROOM_BONUS_POINTS,
  ROOM_CREATE_RATE_LIMIT,
  ROOM_CREATE_RATE_WINDOW_MS,
  ROOM_MESSAGE_PAGE_SIZE,
  ROOM_MESSAGE_RATE_LIMIT,
  ROOM_MESSAGE_RATE_WINDOW_MS,
  ROOM_SLOTS_PAGE_SIZE,
} from "@/constant";
import { db } from "@/db";
import {
  rooms,
  roomMembers,
  roomMessages,
  roomTimeSlots,
  roomTimeSlotVotes,
  roomCompletions,
  roomBonusAwards,
  user,
} from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, getTableColumns, gte, ilike, inArray, ne, sql } from "drizzle-orm";
import z from "zod";
import { roomsInsertSchema, sendRoomMessageSchema, proposeSlotSchema } from "../schema";
import { assertRoomMember } from "@/lib/authz";
import { streamVideo } from "@/lib/stream-video";
import { generateAvatarUri } from "@/lib/avatar";

// Shared by `leave` and `removeMember`: drops a member's row plus anything
// that would otherwise linger and keep influencing quorum/votes after they're
// no longer part of the room.
async function removeMemberFromRoom(roomId: string, userId: string) {
  await db
    .delete(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)));

  await db
    .delete(roomCompletions)
    .where(and(eq(roomCompletions.roomId, roomId), eq(roomCompletions.userId, userId)));

  await db
    .delete(roomTimeSlotVotes)
    .where(and(eq(roomTimeSlotVotes.roomId, roomId), eq(roomTimeSlotVotes.userId, userId)));
}

export const roomsRouter = createTRPCRouter({
  getMany: protectedProcedure
    .input(
      z.object({
        page: z.number().default(DEFAULT_PAGE),
        pageSize: z.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        search: z.string().nullish(),
        status: z.enum(["open", "scheduled", "completed", "cancelled"]).nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search, status } = input;

      // Default view hides cancelled rooms; explicitly filtering by a status
      // (including "cancelled") shows exactly that status instead.
      const statusFilter = status ? eq(rooms.status, status) : ne(rooms.status, "cancelled");

      const data = await db
        .select(getTableColumns(rooms))
        .from(rooms)
        .where(
          and(
            statusFilter,
            search ? ilike(rooms.topic, `%${search}%`) : undefined,
          )
        )
        .orderBy(desc(rooms.createdAt), desc(rooms.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [totalCount] = await db
        .select({ count: count() })
        .from(rooms)
        .where(
          and(
            statusFilter,
            search ? ilike(rooms.topic, `%${search}%`) : undefined,
          )
        );

      const roomIds = data.map((r) => r.id);

      const memberCounts = roomIds.length
        ? await db
            .select({ roomId: roomMembers.roomId, memberCount: count() })
            .from(roomMembers)
            .where(inArray(roomMembers.roomId, roomIds))
            .groupBy(roomMembers.roomId)
        : [];

      const myMemberships = roomIds.length
        ? await db
            .select({ roomId: roomMembers.roomId })
            .from(roomMembers)
            .where(
              and(
                inArray(roomMembers.roomId, roomIds),
                eq(roomMembers.userId, ctx.auth.user.id)
              )
            )
        : [];

      const memberCountMap = new Map(memberCounts.map((m) => [m.roomId, m.memberCount]));
      const myMembershipSet = new Set(myMemberships.map((m) => m.roomId));

      const items = data.map((room) => ({
        ...room,
        memberCount: memberCountMap.get(room.id) ?? 0,
        isMember: myMembershipSet.has(room.id),
      }));

      const totalPages = Math.ceil(totalCount.count / pageSize);
      return { items, totalCount: totalCount.count, totalPages };
    }),

  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [room] = await db.select().from(rooms).where(eq(rooms.id, input.id));
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }

      const members = await db
        .select({
          userId: roomMembers.userId,
          name: user.name,
          image: user.image,
          joinedAt: roomMembers.joinedAt,
        })
        .from(roomMembers)
        .innerJoin(user, eq(roomMembers.userId, user.id))
        .where(eq(roomMembers.roomId, room.id))
        .orderBy(asc(roomMembers.joinedAt));

      const isMember = members.some((m) => m.userId === ctx.auth.user.id);

      const [myCompletion] = await db
        .select({ id: roomCompletions.id })
        .from(roomCompletions)
        .where(
          and(
            eq(roomCompletions.roomId, room.id),
            eq(roomCompletions.userId, ctx.auth.user.id)
          )
        );

      return {
        ...room,
        members,
        memberCount: members.length,
        isMember,
        completedByMe: !!myCompletion,
      };
    }),

  create: protectedProcedure.input(roomsInsertSchema).mutation(async ({ ctx, input }) => {
    const [{ recentCount }] = await db
      .select({ recentCount: count() })
      .from(rooms)
      .where(
        and(
          eq(rooms.createdBy, ctx.auth.user.id),
          gte(rooms.createdAt, new Date(Date.now() - ROOM_CREATE_RATE_WINDOW_MS))
        )
      );

    if (recentCount >= ROOM_CREATE_RATE_LIMIT) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "You've created too many rooms recently. Please try again later.",
      });
    }

    const [createdRoom] = await db
      .insert(rooms)
      .values({ topic: input.topic, createdBy: ctx.auth.user.id })
      .returning();

    await db.insert(roomMembers).values({ roomId: createdRoom.id, userId: ctx.auth.user.id });

    return createdRoom;
  }),

  join: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [room] = await db
        .select({ id: rooms.id, status: rooms.status })
        .from(rooms)
        .where(eq(rooms.id, input.roomId));

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.status === "completed" || room.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This room is no longer open." });
      }

      await db
        .insert(roomMembers)
        .values({ roomId: input.roomId, userId: ctx.auth.user.id })
        .onConflictDoNothing();

      return { success: true };
    }),

  leave: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [room] = await db
        .select({ createdBy: rooms.createdBy })
        .from(rooms)
        .where(eq(rooms.id, input.roomId));

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.createdBy === ctx.auth.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The room creator cannot leave the room.",
        });
      }

      await removeMemberFromRoom(input.roomId, ctx.auth.user.id);

      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ roomId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [room] = await db
        .select({ createdBy: rooms.createdBy })
        .from(rooms)
        .where(eq(rooms.id, input.roomId));

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.createdBy !== ctx.auth.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the room creator can remove a member.",
        });
      }
      if (input.userId === ctx.auth.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The room creator cannot remove themself.",
        });
      }

      await removeMemberFromRoom(input.roomId, input.userId);

      return { success: true };
    }),

  cancel: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [room] = await db
        .select({ createdBy: rooms.createdBy, status: rooms.status })
        .from(rooms)
        .where(eq(rooms.id, input.roomId));

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.createdBy !== ctx.auth.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the room creator can cancel this room.",
        });
      }
      if (room.status === "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This room is already completed and can't be cancelled.",
        });
      }

      const [updatedRoom] = await db
        .update(rooms)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(rooms.id, input.roomId), ne(rooms.status, "completed")))
        .returning();

      if (!updatedRoom) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This room is already completed and can't be cancelled.",
        });
      }

      return updatedRoom;
    }),

  listMessages: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertRoomMember(input.roomId, ctx.auth.user.id);

      const rows = await db
        .select({
          id: roomMessages.id,
          userId: roomMessages.userId,
          senderName: user.name,
          senderImage: user.image,
          content: roomMessages.content,
          createdAt: roomMessages.createdAt,
          editedAt: roomMessages.editedAt,
        })
        .from(roomMessages)
        .innerJoin(user, eq(roomMessages.userId, user.id))
        .where(eq(roomMessages.roomId, input.roomId))
        .orderBy(desc(roomMessages.createdAt))
        .limit(ROOM_MESSAGE_PAGE_SIZE);

      return rows.reverse();
    }),

  sendMessage: protectedProcedure
    .input(sendRoomMessageSchema)
    .mutation(async ({ ctx, input }) => {
      await assertRoomMember(input.roomId, ctx.auth.user.id);

      const [{ recentCount }] = await db
        .select({ recentCount: count() })
        .from(roomMessages)
        .where(
          and(
            eq(roomMessages.userId, ctx.auth.user.id),
            gte(roomMessages.createdAt, new Date(Date.now() - ROOM_MESSAGE_RATE_WINDOW_MS))
          )
        );

      if (recentCount >= ROOM_MESSAGE_RATE_LIMIT) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "You're sending messages too fast. Please slow down.",
        });
      }

      await db.insert(roomMessages).values({
        roomId: input.roomId,
        userId: ctx.auth.user.id,
        content: input.content,
      });

      return { success: true };
    }),

  editMessage: protectedProcedure
    .input(z.object({ messageId: z.string(), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(roomMessages)
        .set({ content: input.content, editedAt: new Date() })
        .where(and(eq(roomMessages.id, input.messageId), eq(roomMessages.userId, ctx.auth.user.id)))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found, or you don't own it.",
        });
      }

      return updated;
    }),

  deleteMessage: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await db
        .delete(roomMessages)
        .where(and(eq(roomMessages.id, input.messageId), eq(roomMessages.userId, ctx.auth.user.id)))
        .returning({ id: roomMessages.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found, or you don't own it.",
        });
      }

      return { success: true };
    }),

  listSlots: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertRoomMember(input.roomId, ctx.auth.user.id);

      const slots = await db
        .select({
          ...getTableColumns(roomTimeSlots),
          proposerName: user.name,
        })
        .from(roomTimeSlots)
        .innerJoin(user, eq(roomTimeSlots.proposedBy, user.id))
        .where(eq(roomTimeSlots.roomId, input.roomId))
        .orderBy(desc(roomTimeSlots.createdAt))
        .limit(ROOM_SLOTS_PAGE_SIZE);

      const voteCounts = await db
        .select({ slotId: roomTimeSlotVotes.slotId, voteCount: count() })
        .from(roomTimeSlotVotes)
        .where(eq(roomTimeSlotVotes.roomId, input.roomId))
        .groupBy(roomTimeSlotVotes.slotId);

      const [myVote] = await db
        .select({ slotId: roomTimeSlotVotes.slotId })
        .from(roomTimeSlotVotes)
        .where(
          and(
            eq(roomTimeSlotVotes.roomId, input.roomId),
            eq(roomTimeSlotVotes.userId, ctx.auth.user.id)
          )
        );

      const voteCountMap = new Map(voteCounts.map((v) => [v.slotId, v.voteCount]));

      return slots
        .map((slot) => ({
          ...slot,
          voteCount: voteCountMap.get(slot.id) ?? 0,
          votedByMe: myVote?.slotId === slot.id,
        }))
        .sort((a, b) => b.voteCount - a.voteCount);
    }),

  proposeSlot: protectedProcedure
    .input(proposeSlotSchema)
    .mutation(async ({ ctx, input }) => {
      await assertRoomMember(input.roomId, ctx.auth.user.id);

      const [room] = await db
        .select({ status: rooms.status })
        .from(rooms)
        .where(eq(rooms.id, input.roomId));

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.status === "completed" || room.status === "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This room is no longer open for scheduling.",
        });
      }

      const [createdSlot] = await db
        .insert(roomTimeSlots)
        .values({ roomId: input.roomId, proposedBy: ctx.auth.user.id, slotTime: input.slotTime })
        .returning();

      return createdSlot;
    }),

  voteSlot: protectedProcedure
    .input(z.object({ slotId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [slot] = await db
        .select({ roomId: roomTimeSlots.roomId })
        .from(roomTimeSlots)
        .where(eq(roomTimeSlots.id, input.slotId));

      if (!slot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Time slot not found" });
      }
      await assertRoomMember(slot.roomId, ctx.auth.user.id);

      // Switch the caller's vote: clear any existing vote in this room, then cast the new one.
      await db
        .delete(roomTimeSlotVotes)
        .where(
          and(eq(roomTimeSlotVotes.roomId, slot.roomId), eq(roomTimeSlotVotes.userId, ctx.auth.user.id))
        );

      await db.insert(roomTimeSlotVotes).values({
        slotId: input.slotId,
        roomId: slot.roomId,
        userId: ctx.auth.user.id,
      });

      return { success: true };
    }),

  finalizeSlot: protectedProcedure
    .input(z.object({ slotId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [slot] = await db.select().from(roomTimeSlots).where(eq(roomTimeSlots.id, input.slotId));
      if (!slot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Time slot not found" });
      }
      await assertRoomMember(slot.roomId, ctx.auth.user.id);

      const [updatedRoom] = await db
        .update(rooms)
        .set({ status: "scheduled", scheduledAt: slot.slotTime, updatedAt: new Date() })
        .where(and(eq(rooms.id, slot.roomId), eq(rooms.status, "open")))
        .returning();

      if (!updatedRoom) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This room already has a finalized or closed schedule.",
        });
      }

      // Best-effort: set up the group video call for the scheduled time.
      // A failure here shouldn't undo the (already-committed) schedule finalize.
      try {
        const members = await db
          .select({ userId: roomMembers.userId, name: user.name, image: user.image })
          .from(roomMembers)
          .innerJoin(user, eq(roomMembers.userId, user.id))
          .where(eq(roomMembers.roomId, slot.roomId));

        await streamVideo.upsertUsers(
          members.map((m) => ({
            id: m.userId,
            name: m.name || "User",
            role: "user",
            image: m.image ?? generateAvatarUri({ seed: m.name, variant: "initials" }),
          }))
        );

        const call = streamVideo.video.call("default", updatedRoom.id);
        await call.create({
          data: {
            created_by_id: ctx.auth.user.id,
            custom: {
              roomId: updatedRoom.id,
              roomTopic: updatedRoom.topic,
            },
            starts_at: updatedRoom.scheduledAt ?? undefined,
          },
        });
      } catch (err) {
        console.error("Failed to create Stream call for room", updatedRoom.id, err);
      }

      return updatedRoom;
    }),

  markComplete: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertRoomMember(input.roomId, ctx.auth.user.id);

      await db
        .insert(roomCompletions)
        .values({ roomId: input.roomId, userId: ctx.auth.user.id })
        .onConflictDoNothing();

      const [room] = await db.select({ status: rooms.status }).from(rooms).where(eq(rooms.id, input.roomId));
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.status === "completed") {
        return { completed: true, bonusAwarded: false };
      }

      const [{ completions }] = await db
        .select({ completions: count() })
        .from(roomCompletions)
        .where(eq(roomCompletions.roomId, input.roomId));

      const members = await db
        .select({ userId: roomMembers.userId })
        .from(roomMembers)
        .where(eq(roomMembers.roomId, input.roomId));

      const quorum = Math.ceil(members.length / 2);
      if (members.length === 0 || completions < quorum) {
        return { completed: false, bonusAwarded: false };
      }

      // Compare-and-swap guard: only the request that actually flips the
      // status (no transactions on the neon-http driver) awards the bonus.
      const [updatedRoom] = await db
        .update(rooms)
        .set({ status: "completed", updatedAt: new Date() })
        .where(and(eq(rooms.id, input.roomId), ne(rooms.status, "completed")))
        .returning();

      if (!updatedRoom) {
        return { completed: true, bonusAwarded: false };
      }

      await db.insert(roomBonusAwards).values(
        members.map((m) => ({
          roomId: input.roomId,
          userId: m.userId,
          points: ROOM_BONUS_POINTS,
        }))
      );

      return { completed: true, bonusAwarded: true };
    }),

  getMyBonusTotal: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${roomBonusAwards.points}), 0)`.mapWith(Number).as("total"),
      })
      .from(roomBonusAwards)
      .where(eq(roomBonusAwards.userId, ctx.auth.user.id));

    return row?.total ?? 0;
  }),

  getBonusLeaderboard: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          userId: roomBonusAwards.userId,
          name: user.name,
          image: user.image,
          total: sql<number>`SUM(${roomBonusAwards.points})`.mapWith(Number).as("total"),
        })
        .from(roomBonusAwards)
        .innerJoin(user, eq(roomBonusAwards.userId, user.id))
        .groupBy(roomBonusAwards.userId, user.name, user.image)
        .orderBy(desc(sql`SUM(${roomBonusAwards.points})`))
        .limit(input.limit);

      return rows;
    }),
});
