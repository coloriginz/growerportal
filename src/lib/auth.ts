import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
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
          include: { supplier: true },
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
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        token.role = user.role;
        token.supplierId = user.supplierId;
        token.supplierCode = user.supplierCode;
        token.transporterId = user.transporterId;
      }
      // Re-read from DB when client calls update() (e.g. after profile change)
      if (trigger === "update" && updateData?.refreshFromDb) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub! },
          include: { supplier: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.supplierId = dbUser.supplierId;
          token.supplierCode = dbUser.supplier?.code ?? null;
          token.transporterId = dbUser.transporterId;
        }
      }
      // Test mode role override — only stored in JWT, not in DB.
      // On re-login the token is created fresh from DB (original role).
      if (trigger === "update" && updateData?.switchRole) {
        // Preserve original role on first switch so we can show it in banner
        if (!token.originalRole) {
          token.originalRole = token.role;
        }
        token.role = updateData.switchRole;
      }
      // Test mode: switch to a specific supplier entity
      if (trigger === "update" && updateData?.switchSupplierId !== undefined) {
        token.supplierId = updateData.switchSupplierId;
        token.supplierCode = updateData.switchSupplierCode || null;
        // Clear transporter when switching to supplier
        token.transporterId = null;
      }
      // Test mode: switch to a specific transporter entity
      if (trigger === "update" && updateData?.switchTransporterId !== undefined) {
        token.transporterId = updateData.switchTransporterId;
        // Clear supplier when switching to transporter
        token.supplierId = null;
        token.supplierCode = null;
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
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  trustHost: true,
});
