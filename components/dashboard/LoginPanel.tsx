"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowLeft, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function LoginPanel() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setStatus(null);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      setStatus("Acesso confirmado. O painel ja pode carregar dados da empresa.");
      router.push("/");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Nao foi possivel validar o acesso agora."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 py-10 text-ink">
      <section className="w-full max-w-md rounded-lg border border-black/10 bg-white p-6 shadow-soft">
        <Link
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-paper px-3 text-sm font-semibold text-black/70 ring-1 ring-black/10 hover:bg-black/[0.04]"
          href="/"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Voltar
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-ink text-sm font-black text-white">
            DM
          </span>
          <div>
            <h1 className="text-2xl font-black tracking-normal">DASHMARKET</h1>
            <p className="text-sm text-black/60">Acesso ao painel de marketplace</p>
          </div>
        </div>

        <form className="mt-6 grid gap-4" onSubmit={handleLogin}>
          <label className="grid gap-1 text-sm font-semibold">
            E-mail
            <span className="relative">
              <Mail
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40"
              />
              <input
                className="h-11 w-full rounded-lg border border-black/10 bg-paper pl-9 pr-3 font-normal outline-none focus:ring-4 focus:ring-sea/20"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="usuario@empresa.com.br"
                type="email"
                value={email}
              />
            </span>
          </label>

          <label className="grid gap-1 text-sm font-semibold">
            Senha
            <span className="relative">
              <LockKeyhole
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40"
              />
              <input
                className="h-11 w-full rounded-lg border border-black/10 bg-paper pl-9 pr-3 font-normal outline-none focus:ring-4 focus:ring-sea/20"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Sua senha"
                type="password"
                value={password}
              />
            </span>
          </label>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-bold text-white hover:bg-black"
            disabled={isLoading}
            type="submit"
          >
            <ShieldCheck aria-hidden className="h-4 w-4" />
            {isLoading ? "Validando" : "Entrar"}
          </button>
        </form>

        {status && (
          <p className="mt-4 rounded-lg bg-paper px-3 py-3 text-sm font-semibold text-black/70 ring-1 ring-black/10">
            {status}
          </p>
        )}
      </section>
    </main>
  );
}
