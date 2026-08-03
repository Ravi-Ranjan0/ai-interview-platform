import { Input } from "@/components/ui/input";
import { SearchIcon } from "lucide-react";
import { useRoomsFilters } from "../../hooks/use-rooms-filters";

export const RoomsSearchFilter = () => {
  const [filter, setFilter] = useRoomsFilters();
  return (
    <div className="relative">
      <Input
        placeholder="Filter by topic"
        value={filter.search}
        onChange={(e) => setFilter({ search: e.target.value })}
        className="h-9 bg-white w-[200px] pl-7"
      />
      <SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
};
