import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-dark-1000 flex items-center justify-center p-6">
      <SignUp routing="path" path="/register" signInUrl="/login" forceRedirectUrl="/dashboard" />
    </main>
  );
}
