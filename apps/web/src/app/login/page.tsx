"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-1000 flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-10">
          <div className="w-10 h-10 bg-hive-500 rounded-xl flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span className="text-xl font-bold text-white">CompeteHive</span>
        </Link>

        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8">
          <h1 className="text-2xl font-bold text-white mb-2">Giriş Yap</h1>
          <p className="text-dark-500 text-sm mb-8">CompeteHive hesabınıza erişin.</p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">E-posta</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({...form, email: e.target.value})}
                className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
                placeholder="ornek@email.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">Şifre</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm({...form, password: e.target.value})}
                className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 font-semibold py-3 rounded-xl transition text-sm"
            >
              {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
            </button>
          </form>
        </div>

        <p className="text-center text-dark-500 text-sm mt-6">
          Hesabınız yok mu?{" "}
          <Link href="/register" className="text-hive-500 hover:text-hive-400 transition">Ücretsiz Kayıt Ol</Link>
        </p>
      </div>
    </div>
  );
}
