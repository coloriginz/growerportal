import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    supplierId?: string | null;
    supplierCode?: string | null;
    transporterId?: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      supplierId: string | null;
      supplierCode: string | null;
      transporterId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    supplierId?: string | null;
    supplierCode?: string | null;
    transporterId?: string | null;
    originalRole?: string;
  }
}
