import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { upsertUser } from "@/lib/db";

// Auth.js v5. Google provider auto-reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET.
// Any Google account may sign in and use the app immediately (no approval gate).
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // Google's OIDC discovery advertises `authorization_response_iss_parameter_supported`,
    // which makes @auth/core (v5 beta / oauth4webapi) *require* an `iss` param on the
    // callback. Behind our Caddy reverse proxy that check fails with
    //   CallbackRouteError: response parameter "iss" (issuer) missing
    // even though PKCE round-trips fine. Pin the checks to PKCE + state (the CSRF
    // protection we actually rely on) so the spurious iss enforcement is dropped.
    Google({ checks: ["pkce", "state"] }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user, profile }) {
      if (!profile?.sub || !user.email) return false;
      upsertUser({
        id: profile.sub,
        email: user.email,
        name: user.name ?? null,
        image: user.image ?? null,
      });
      return true;
    },
    async jwt({ token, profile }) {
      if (profile?.sub) token.uid = profile.sub;
      return token;
    },
    async session({ session, token }) {
      const uid = token.uid as string | undefined;
      if (uid && session.user) {
        session.user.id = uid;
      }
      return session;
    },
  },
});
