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
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
