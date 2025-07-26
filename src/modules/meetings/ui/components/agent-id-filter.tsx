import { CommandSelect } from "@/components/command-select";
import { useMeetingsFilters } from "../../hooks/use-meetings-filters";
import { useTRPC } from "@/trpc/clients";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { GeneratedAvatar } from "@/components/generated-avatar";

export const AgentIdFilter = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useMeetingsFilters();
  const [agentSearch, setAgentSearch] = useState("");

  const {data} = useQuery(
    trpc.agents.getMany.queryOptions({
      pageSize: 100,
      search: agentSearch,
    })
  );

  return (
    <CommandSelect
    className="h-9"

      options={(data?.items ?? []).map((agent) => ({
        id: agent.id,
        value: agent.id,
        children: (
          <div className="flex items-center gap-x-2">
            <GeneratedAvatar
              seed={agent.name}
              variant="bottsNeutral"
              className="border size-6"
            />
            <span className="">{agent.name}</span>
          </div>
        ),
      }))}
      value={filters.agentId || ""}
      onSelect={(value) => setFilters({ agentId: value })}
      onSearch={setAgentSearch}
      placeholder="Filter by Agent ID"
      isSearchable={false}
    />
  );
};
