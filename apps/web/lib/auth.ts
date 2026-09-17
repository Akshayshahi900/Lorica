import { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { serverEnv } from "@/lib/env";

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: serverEnv.githubId,
      clientSecret: serverEnv.githubSecret,
      // Request read:org so we can later list org repos
      authorization: {
        params: {
          scope: "read:user user:email repo read:org",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // Persist the GitHub access token so we can call the API later
      if (account) {
        token.accessToken = account.access_token;
        token.login = (profile as { login?: string })?.login;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose accessToken and login to client session
      (session as any).accessToken = token.accessToken;
      (session as any).login = token.login;
      return session;
    },
  },
  pages: {
    signIn: "/",     // redirect unauthenticated users to landing page
    error: "/",
  },
  session: {
    strategy: "jwt",
  },
};
