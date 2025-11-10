"use client";

import { ColumnDef } from "@tanstack/react-table"
import { ConversationGetMany } from "../../type"

export const columns: ColumnDef<ConversationGetMany[number]>[] = [
    {
        accessorKey: "title",
        header: "Conversation Title",
        cell: ({ row }) => (
            <span className="font-medium capitalize">{row.original.title}</span>
        ),
    }
]