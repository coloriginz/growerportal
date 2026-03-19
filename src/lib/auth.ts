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
          include: { grower: true },
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
          growerId: user.growerId,
          growerCode: user.grower?.code,
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
        token.growerId = user.growerId;
        token.growerCode = user.growerCode;
        token.transporterId = user.transporterId;
      }
      // Re-read from DB when client calls update() (e.g. after role switch)
      if (trigger === "update" && updateData?.refreshFromDb) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub! },
          include: { grower: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.growerId = dbUser.growerId;
          token.growerCode = dbUser.grower?.code ?? null;
          token.transporterId = dbUser.transporterId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role as string;
        session.user.growerId = token.growerId as string | null;
        session.user.growerCode = token.growerCode as string | null;
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
