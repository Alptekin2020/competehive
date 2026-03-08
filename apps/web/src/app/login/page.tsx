"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Giriş başarısız.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Bir hata oluştu. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Giriş Yap</h1>
          <p className="text-gray-400">CompeteHive hesabınıza giriş yapın</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#111113] border border-[#222] rounded-2xl p-8 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
              E-posta
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#0A0A0B] border border-[#333] rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-[#F59E0B] transition"
              placeholder="ornek@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
              Şifre
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#0A0A0B] border border-[#333] rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-[#F59E0B] transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg transition"
          >
            {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>

          <p className="text-center text-sm text-gray-400">
            Hesabınız yok mu?{" "}
            <Link href="/register" className="text-[#F59E0B] hover:underline">
              Kayıt Ol
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
