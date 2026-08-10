import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { isTest } from "@/lib/env";
import { ENTRA_PROVIDER_ID, decideEntraSignIn, resolveEntraEmail } from "@/lib/entra-sign-in";

/**
 * Entra is only wired up when all three settings are present. Switching on the
 * client id alone leaves a half-configured provider that fails at the redirect
 * instead of simply not being offered.
 */
export const entraEnabled = Boolean(
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
);

/** Look up the portal account behind an Entra identity. Email compare is case-insensitive. */
async function findEntraUser(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    include: { supplier: true, companies: { select: { id: true } } },
  });
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    ...(entraEnabled
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
            // Without select_account Azure signs straight back in with the last
            // used account, which makes testing with two accounts baffling.
            authorization: {
              params: { prompt: "select_account", scope: "openid profile email User.Read" },
            },
            // Entra supplies identity, nothing else. Role, supplier and company
            // access come from our own database in the jwt callback below.
            // Overriding profile() also skips the provider's default Graph call
            // for a profile photo, which we do not use.
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name ?? null,
                email: resolveEntraEmail(profile),
              };
            },
          }),
        ]
      : []),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { supplier: true, companies: { select: { id: true } } },
        });

        if (!user || !user.passwordHash || !user.isActive) {
          return null;
        }

        const isValid = await compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          supplierId: user.supplierId,
          supplierCode: user.supplier?.code,
          transporterId: user.transporterId,
          kbtCode: user.kbtCode,
          companyIds: user.companies.map((c) => c.id),
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    /**
     * Gatekeeper for Entra logins. Credentials logins are already decided by
     * authorize(), so they pass straight through.
     *
     * A signIn callback cannot show a message — it returns true, false, or a
     * URL. So refusals redirect to the login page with a code, which the page
     * checks against its own allowlist before displaying anything.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== ENTRA_PROVIDER_ID) return true;

      const email = resolveEntraEmail(profile ?? {});
      const dbUser = email ? await findEntraUser(email) : null;
      const decision = decideEntraSignIn({
        email,
        account: dbUser && { id: dbUser.id, role: dbUser.role, isActive: dbUser.isActive },
      });

      if (!decision.allowed) return `/login?error=${decision.error}`;

      // Record the object id so we can move the match off email later. Never
      // let this fail a login that is otherwise fine: a unique-constraint clash
      // here (an old row still holding the oid after someone's address changed)
      // must not lock a valid user out.
      const oid = (profile as { oid?: string } | undefined)?.oid;
      if (oid && dbUser && dbUser.entraOid !== oid) {
        try {
          await prisma.user.update({ where: { id: dbUser.id }, data: { entraOid: oid } });
        } catch {
          // Best-effort only.
        }
      }

      // Carry our own id forward so the jwt callback keys off the portal user,
      // not the Entra subject.
      user.id = dbUser!.id;
      return true;
    },
    async jwt({ token, user, account, trigger, session: updateData }) {
      const fromEntra = account?.provider === ENTRA_PROVIDER_ID;

      // Credentials logins carry their claims on `user`. Entra logins do not —
      // its profile() deliberately returns identity only — so skip this branch
      // for them and read from the database just below.
      if (user && !fromEntra) {
        token.role = user.role;
        token.supplierId = user.supplierId;
        token.supplierCode = user.supplierCode;
        token.transporterId = user.transporterId;
        token.kbtCode = user.kbtCode;
        token.companyIds = user.companyIds;
      }

      // Entra supplies identity only; role, supplier and company access come
      // from our own database.
      if (fromEntra && token.email) {
        const dbUser = await findEntraUser(token.email);
        if (dbUser) {
          token.sub = dbUser.id;
          token.role = dbUser.role;
          token.supplierId = dbUser.supplierId;
          token.supplierCode = dbUser.supplier?.code ?? null;
          token.transporterId = dbUser.transporterId;
          token.kbtCode = dbUser.kbtCode;
          token.companyIds = dbUser.companies.map((c) => c.id);
        }
      }

      // Re-read from DB when client calls update() (e.g. after profile change)
      if (trigger === "update" && updateData?.refreshFromDb) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub! },
          include: { supplier: true, companies: { select: { id: true } } },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.supplierId = dbUser.supplierId;
          token.supplierCode = dbUser.supplier?.code ?? null;
          token.transporterId = dbUser.transporterId;
          token.kbtCode = dbUser.kbtCode;
          token.companyIds = dbUser.companies.map((c) => c.id);
        }
      }
      // Test mode overrides — only allowed in test/development environments.
      // On re-login the token is created fresh from DB (original role).
      if (isTest && trigger === "update") {
        if (updateData?.switchRole) {
          // Preserve original role on first switch so we can show it in banner
          if (!token.originalRole) {
            token.originalRole = token.role;
          }
          token.role = updateData.switchRole;
        }
        // Switch to a specific supplier entity
        if (updateData?.switchSupplierId !== undefined) {
          token.supplierId = updateData.switchSupplierId;
          token.supplierCode = updateData.switchSupplierCode || null;
          // Clear transporter when switching to supplier
          token.transporterId = null;
        }
        // Switch to a specific transporter entity
        if (updateData?.switchTransporterId !== undefined) {
          token.transporterId = updateData.switchTransporterId;
          // Clear supplier when switching to transporter
          token.supplierId = null;
          token.supplierCode = null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role as string;
        session.user.supplierId = token.supplierId as string | null;
        session.user.supplierCode = token.supplierCode as string | null;
        session.user.transporterId = token.transporterId as string | null;
        session.user.kbtCode = (token.kbtCode as string) || null;
        session.user.companyIds = (token.companyIds as string[]) || [];
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  trustHost: true,
});
