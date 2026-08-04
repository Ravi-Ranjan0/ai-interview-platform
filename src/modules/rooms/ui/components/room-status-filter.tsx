import { CalendarClockIcon, CircleCheckIcon, CircleXIcon, DoorOpenIcon } from "lucide-react";
import { RoomStatus } from "../../type";
import { useRoomsFilters } from "../../hooks/use-rooms-filters";
import { CommandSelect } from "@/components/command-select";

const options = [
  {
    id: RoomStatus.Open,
    value: RoomStatus.Open,
    children: (
      <div className="flex items-center gap-x-2 capitalize">
        <DoorOpenIcon />
        {RoomStatus.Open}
      </div>
    ),
  },
  {
    id: RoomStatus.Scheduled,
    value: RoomStatus.Scheduled,
    children: (
      <div className="flex items-center gap-x-2 capitalize">
        <CalendarClockIcon />
        {RoomStatus.Scheduled}
      </div>
    ),
  },
  {
    id: RoomStatus.Completed,
    value: RoomStatus.Completed,
    children: (
      <div className="flex items-center gap-x-2 capitalize">
        <CircleCheckIcon />
        {RoomStatus.Completed}
      </div>
    ),
  },
  {
    id: RoomStatus.Cancelled,
    value: RoomStatus.Cancelled,
    children: (
      <div className="flex items-center gap-x-2 capitalize">
        <CircleXIcon />
        {RoomStatus.Cancelled}
      </div>
    ),
  },
];

export const RoomStatusFilter = () => {
  const [filters, setFilters] = useRoomsFilters();

  return (
    <CommandSelect
      options={options}
      value={filters.status || ""}
      onSelect={(value) => setFilters({ status: value as RoomStatus })}
      placeholder="Status"
      isSearchable={false}
      className="h-9"
    />
  );
};
