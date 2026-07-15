import type { Metadata } from "next";
import "./globals.css";
import { BuildFooter } from "@/components/BuildFooter";

export const metadata: Metadata = {
  title: "Confidential Chat",
  description: "Private LLM chat running inside a hardware-encrypted TEE.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        {/* Server-rendered so it can read the deploy-time IMAGE_DIGEST env. */}
        <BuildFooter />
      </body>
    </html>
  );
}
