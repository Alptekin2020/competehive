"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function VerifyEmailPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/register");
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0B]">
      <p className="text-white">Yönlendiriliyor...</p>
    </div>
  );
}
