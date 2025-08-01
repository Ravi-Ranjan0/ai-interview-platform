import { useState } from "react";
import { Button } from "./ui/button";
import { ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandEmpty, CommandInput, CommandItem, CommandList, CommandResponsiveDialog } from "./ui/command";
import { on } from "events";
import { se } from "date-fns/locale";


interface Props{
    options: Array<{
        id: string;
        value: string;
        children: React.ReactNode;
    }>;
    onSelect: (value: string) => void;
    onSearch?: (query: string) => void;
    value: string;
    placeholder?: string;
    isSearchable?: boolean;
    className?: string;
}

export const CommandSelect = ({
    options,
    onSelect,
    onSearch,
    value,
    placeholder = "Search an option...",
    isSearchable,
    className,
}: Props) => {
    const [open, setOpen] = useState(false);
    const selectedOption = options.find(option => option.value === value);
    const handleOpenChange = (open: boolean) => {
        onSearch?.("");
        setOpen(open);
    };

    return (
        <>
        <Button
        onClick={() => setOpen(true)}
        type="button"
        variant="outline"
        className={cn("h-9 justify-between font-normal px-2",
            !selectedOption && "text-muted-foreground", className)}
        >
            <div>
                {selectedOption?.children ?? placeholder}
            </div>
            <ChevronsUpDownIcon />

        </Button>
        <CommandResponsiveDialog
            shouldFilter={!onSearch}
            open={open}
            onOpenChange={handleOpenChange}
        >
            <CommandInput placeholder="Search an option..." onValueChange={onSearch} />
            <CommandList>
                <CommandEmpty>
                    <span className="text-muted-foreground text-sm">
                        No options found.
                    </span>
                </CommandEmpty>
                {options.map((option) => (
                    <CommandItem
                        key={option.id}
                        value={option.value}
                        onSelect={() => {
                            onSelect(option.value);
                            setOpen(false);
                        }}
                        className="cursor-pointer"
                    >
                        {option.children}
                    </CommandItem>
                ))}
            </CommandList>
        </CommandResponsiveDialog>
    </>
    );
};
