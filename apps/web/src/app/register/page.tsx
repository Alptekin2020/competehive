import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0A0A0B] p-6">
      <SignUp routing="path" path="/register" signInUrl="/login" forceRedirectUrl="/dashboard" />
    </main>
  );
}
