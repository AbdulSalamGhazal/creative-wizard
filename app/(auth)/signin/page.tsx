import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignInForm } from "@/components/auth/signin-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Already signed in? Skip the form.
  const me = await auth();
  const { next } = await searchParams;
  if (me) {
    redirect(next && next.startsWith("/") ? next : "/");
  }
  return <SignInForm nextPath={next ?? "/"} />;
}
