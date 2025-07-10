"use client";

import { Button } from "@/components/ui/button";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function HomeView() {
  const router = useRouter();
  const { data: session } = authClient.useSession();

  if (session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <h1 className="text-2xl font-bold mb-4">
          Welcome, {session.user.name}!
        </h1>
        <p className="text-lg">You are already logged in.</p>

        <Button
          onClick={() =>
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  router.push("/sign-in");
                },
              },
            })
          }
          className="mt-4"
        >
          Sign Out
        </Button>
      </div>
    );
  }
}
