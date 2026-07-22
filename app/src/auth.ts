import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { upsertUser, getUser } from "@/lib/db";

// Auth.js v5. Google provider auto-reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET.
// Any Google account may sign in; access is then gated on the user's `status`
// (first user ever -> active admin; everyone else -> pending until approved).
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
        // Read fresh from DB so admin approvals take effect without re-login.
        const u = getUser(uid);
        session.user.id = uid;
        session.user.role = u?.role ?? "user";
        session.user.status = u?.status ?? "pending";
      }
      return session;
    },
  },
});
