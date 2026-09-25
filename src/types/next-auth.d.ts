import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      // SCALE-H: the user's passwordChangedAt (epoch ms) as of sign-in, or
      // null if it had never changed. Compared against the database by
      // src/lib/session.ts to reject sessions from before a password change.
      pwdChangedAt?: number | null;
    } & DefaultSession["user"];
  }

  interface User {
    // Only set by the Credentials provider's authorize() (src/lib/auth.ts),
    // read once by the jwt callback at sign-in.
    passwordChangedAt?: Date | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    pwdChangedAt?: number | null;
  }
}
