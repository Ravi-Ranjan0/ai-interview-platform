import { auth } from "@/lib/auth";
import { SignUpView } from "@/modules/auth/ui/views/sign-up-view";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const Page = async () => {

  const session = await auth.api.getSession({
      headers: await headers(),
    });
  
    if (!session) {
      redirect('/sign-in');
    }
  return (
    <SignUpView />
  );
};

export default Page;
