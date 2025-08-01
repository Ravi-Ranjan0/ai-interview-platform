import { GeneratedAvatar } from "@/components/generated-avatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { authClient } from "@/lib/auth-client";
import { ChevronDownIcon, CreditCardIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";

const DashboardUserButton = () => {
  
    const router = useRouter();
    const isMobile = useIsMobile();
    const { data, isPending } = authClient.useSession();



  const handleLogout = () => {
    try {
      authClient.signOut({
        fetchOptions:{
            onSuccess: () => {
                router.push("/sign-in");
            }   
        }
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (isPending || !data?.user) {
    return null;
  }

  if(isMobile){
    return (
      <Drawer>
        <DrawerTrigger className="rounded-lg border border-border/10 p-3 w-full flex items-center justify-between bg-white/5 hover:bg-white/10 overflow-hidden gap-x-2">
        {data.user.image ? (
          <Avatar className="w-8 h-8">
            <AvatarImage src={data.user.image} alt="User Avatar" />
            <AvatarFallback className="bg-gray-200 text-gray-500">
              {data.user.name?.charAt(0).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
        ) : (
            <GeneratedAvatar seed={data.user.id} variant="initials" className="size-9 mr-3"/>
        )}
        <div className="flex flex-col gap-0.5 text-left overflow-hidden flex-1 min-w-0">
            <p className="text-sm truncate w-full">
                {data.user.name}
            </p>
            <p className="text-xs truncate
             w-full">
                {data.user.email}
            </p>
        </div>
        <ChevronDownIcon className="size-4 shrink-0" />
      </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{data.user.name}</DrawerTitle>
            <DrawerDescription>{data.user.email}</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button variant="outline"
              onClick={() => {}}>
                <CreditCardIcon className="size-4 text-black" />
              Billing
            </Button>
            <Button variant="outline"
              onClick={() => {handleLogout}}>
                <LogOutIcon className="size-4 text-black" />
              Logout
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-lg border border-border/10 p-3 w-full flex items-center justify-between bg-white/5 hover:bg-white/10 overflow-hidden gap-x-2">
        {data.user.image ? (
          <Avatar className="w-8 h-8">
            <AvatarImage src={data.user.image} alt="User Avatar" />
            <AvatarFallback className="bg-gray-200 text-gray-500">
              {data.user.name?.charAt(0).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
        ) : (
            <GeneratedAvatar seed={data.user.id} variant="initials" className="size-9 mr-3"/>
        )}
        <div className="flex flex-col gap-0.5 text-left overflow-hidden flex-1 min-w-0">
            <p className="text-sm truncate w-full">
                {data.user.name}
            </p>
            <p className="text-xs truncate
             w-full">
                {data.user.email}
            </p>
        </div>
        <ChevronDownIcon className="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="right" className="w-72 bg-white shadow-lg rounded-lg">
        <DropdownMenuLabel>
            <div className="flex flex-col gap-1">
                <span className="font-medium truncate">{data.user.name}</span>
                <span className="text-xs font-normal text-muted-foreground truncate">{data.user.email}</span>
            </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer flex items-center justify-between">
            <Link href="/billing" className="w-full flex items-center justify-between">
                Billing
                <CreditCardIcon className="size-4"/>
            </Link>
        </DropdownMenuItem>
        <DropdownMenuItem

        onClick={handleLogout}
         className="cursor-pointer flex items-center justify-between">
            Logout
            <LogOutIcon className="size-4"/>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default DashboardUserButton;
