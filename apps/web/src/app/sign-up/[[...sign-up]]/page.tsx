import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
      <SignUp />
    </div>
  );
}
