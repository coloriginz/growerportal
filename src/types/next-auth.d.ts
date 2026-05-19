import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    supplierId?: string | null;
    supplierCode?: string | null;
    transporterId?: string | null;
    kbtCode?: string | null;
    companyIds?: string[];
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
      kbtCode: string | null;
      companyIds: string[];
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    supplierId?: string | null;
    supplierCode?: string | null;
    transporterId?: string | null;
    kbtCode?: string | null;
    companyIds?: string[];
    originalRole?: string;
  }
}
