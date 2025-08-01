import { DEFAULT_PAGE } from "@/constant";
import {createLoader, parseAsInteger, parseAsString} from "nuqs/server";


export const filterSearchParams = {
    search: parseAsString.withDefault("").withOptions({clearOnDefault: true}),
    page: parseAsInteger.withDefault(DEFAULT_PAGE).withOptions({clearOnDefault: true}),
}

export const loadSearchParams = createLoader(filterSearchParams);