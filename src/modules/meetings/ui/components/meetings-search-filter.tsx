import { Input } from "@/components/ui/input";
import { SearchIcon } from "lucide-react";
import { useMeetingsFilters } from "../../hooks/use-meetings-filters";

export const MeetingsSearchFilter =() =>{
    const [filters, setFilters] = useMeetingsFilters();
    return(
        <div className="relative">
            <Input placeholder="Filter by Meetings"
                     value={filters.search}
                     onChange={(e) => setFilters({search: e.target.value})}
                     className="h-9 bg-white w-[200px] pl-7"
            />
            <SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
    );
}