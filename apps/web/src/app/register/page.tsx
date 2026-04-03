import { SignUp } from "@clerk/nextjs";
import { trTR } from "@clerk/localizations";

export default function RegisterPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0A0A0B]">
      <SignUp localization={trTR} forceRedirectUrl="/dashboard" />
    </div>
  );
}
