import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReviewForge — AI Code Review",
  description: "Developer-first AI pull request review workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
