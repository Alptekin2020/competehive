import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/login(.*)",
  "/login/sso-callback(.*)",
  "/register(.*)",
  "/privacy(.*)",
  "/terms(.*)",
  "/kvkk(.*)",
  "/cerez(.*)",
  "/destek(.*)",
  "/api/webhooks(.*)",
  "/api/telegram/webhook(.*)",
  "/api/health",
  "/api/version",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
