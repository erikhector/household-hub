import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";

// Thrown from `authorize` below once the password checks out but the
// account's email is still unverified — lets loginAction (src/lib/actions/
// auth.ts) show "verify your email" instead of the generic "invalid
// credentials" message. Only reachable after a correct password, so it
// never leaks verification status to someone who doesn't already know the
// account's password.
export class EmailNotVerifiedSignin extends CredentialsSignin {
  code = "email-not-verified";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        if (!user.emailVerifiedAt) throw new EmailNotVerifiedSignin();

        return { id: user.id, email: user.email, name: user.displayName };
      },
    }),
  ],
});
