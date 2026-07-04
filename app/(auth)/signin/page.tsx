import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { safeInternalPath } from "@/lib/url";
import { SignInForm } from "@/components/auth/signin-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Already signed in? Skip the form. `next` is user-controlled — constrain it
  // to a same-origin path (an open redirect otherwise: ?next=//evil.com).
  const me = await auth();
  const { next } = await searchParams;
  const nextPath = safeInternalPath(next);
  if (me) {
    redirect(nextPath);
  }
  return <SignInForm nextPath={nextPath} />;
}
