import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    growerId?: string | null;
    growerCode?: string | null;
    transporterId?: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      growerId: string | null;
      growerCode: string | null;
      transporterId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    growerId?: string | null;
    growerCode?: string | null;
    transporterId?: string | null;
  }
}
