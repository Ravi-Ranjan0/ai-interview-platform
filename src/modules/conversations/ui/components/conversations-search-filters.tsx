import { Input } from "@/components/ui/input";
import { SearchIcon } from "lucide-react";
import { useConversationsFilters } from "../../hooks/use-conversations-filters";

export const ConversationsSearchFilter = () => {
  const [filter, setFilter] = useConversationsFilters();
  return (
    <div className="relative">
      <Input
        placeholder="Filter by Conversations"
        value={filter.search}
        onChange={(e) => setFilter({ search: e.target.value })}
        className="h-9 bg-white w-[200px] pl-7"
      />
      <SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
};
