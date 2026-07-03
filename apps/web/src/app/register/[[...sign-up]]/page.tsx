import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-dark-1000 flex flex-col items-center justify-center p-6 gap-4">
      <SignUp routing="path" path="/register" signInUrl="/login" forceRedirectUrl="/dashboard" />
      <p className="text-xs text-dark-500 max-w-sm text-center leading-relaxed">
        Kayıt olarak{" "}
        <Link href="/terms" className="text-hive-500 hover:underline">
          Kullanım Şartları
        </Link>
        &apos;nı kabul etmiş,{" "}
        <Link href="/kvkk" className="text-hive-500 hover:underline">
          KVKK Aydınlatma Metni
        </Link>
        &apos;ni okumuş sayılırsınız.
      </p>
    </main>
  );
}
