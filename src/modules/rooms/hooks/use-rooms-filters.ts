import { DEFAULT_PAGE } from "@/constant"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

export const useRoomsFilters = () => {
    return useQueryStates({
        search: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
        page: parseAsInteger.withDefault(DEFAULT_PAGE).withOptions({ clearOnDefault: true }),
    })
}
