import { DEFAULT_PAGE } from "@/constant";
import { createLoader, parseAsInteger, parseAsString, parseAsStringEnum } from "nuqs/server";
import { RoomStatus } from "./type";

export const filterSearchParams = {
    search: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
    page: parseAsInteger.withDefault(DEFAULT_PAGE).withOptions({ clearOnDefault: true }),
    status: parseAsStringEnum(Object.values(RoomStatus)).withOptions({ clearOnDefault: true }),
}

export const loadSearchParams = createLoader(filterSearchParams);
