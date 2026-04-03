import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0A0A0B]">
      <SignIn forceRedirectUrl="/dashboard" />
    </div>
  );
}
