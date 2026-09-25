import type { NextAuthConfig } from "next-auth";

// Edge-safe config: no providers that touch the database (e.g. Credentials'
// `authorize`, which needs Prisma) so this can run in the proxy/middleware
// Edge runtime. The full config with providers lives in `auth.ts`.
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // SCALE-H: stamp the token with the password version it was issued
        // under. Only reads what authorize() already returned — no Prisma
        // call, so this stays Edge-safe for proxy.ts.
        token.pwdChangedAt = user.passwordChangedAt?.getTime() ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.pwdChangedAt = token.pwdChangedAt as number | null | undefined;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
