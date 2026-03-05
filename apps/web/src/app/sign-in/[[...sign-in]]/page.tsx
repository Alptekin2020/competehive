import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-dark-1000 flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-10">
          <img src="/competehive-logo.png" alt="CompeteHive" className="w-10 h-10" />
          <span className="text-xl font-bold text-white">CompeteHive</span>
        </Link>
        <SignIn
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "w-full bg-dark-900 border border-dark-800 rounded-2xl shadow-none",
            },
          }}
        />
      </div>
    </div>
  );
}
