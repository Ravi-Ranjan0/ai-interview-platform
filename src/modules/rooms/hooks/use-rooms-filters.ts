import { DEFAULT_PAGE } from "@/constant"
import { parseAsInteger, parseAsString, useQueryStates, parseAsStringEnum } from "nuqs"
import { RoomStatus } from "../type"

export const useRoomsFilters = () => {
    return useQueryStates({
        search: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
        page: parseAsInteger.withDefault(DEFAULT_PAGE).withOptions({ clearOnDefault: true }),
        status: parseAsStringEnum(Object.values(RoomStatus)).withOptions({ clearOnDefault: true }),
    })
}
