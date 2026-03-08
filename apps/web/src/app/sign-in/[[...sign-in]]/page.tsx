import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
      <SignIn />
    </div>
  );
}
