import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0A0A0B]">
      <SignUp forceRedirectUrl="/dashboard" />
    </div>
  );
}
