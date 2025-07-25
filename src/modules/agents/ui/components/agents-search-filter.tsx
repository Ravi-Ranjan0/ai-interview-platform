import { Input } from "@/components/ui/input";
import { useAgentsFilters } from "../../hooks/use-agents-filters";
import { SearchIcon } from "lucide-react";

export const AgentsSearchFilter =() =>{
    const [filters, setFilters] = useAgentsFilters();

    return(
        <div className="relative">
            <Input placeholder="Filter by Name"
                     value={filters.search}
                     onChange={(e) => setFilters({search: e.target.value})}
                     className="h-9 bg-white w-[200px] pl-7"
            />
            <SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
    );
}