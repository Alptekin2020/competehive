"use client";

import { useEffect } from "react";

/**
 * Redirects to sign-in when a same-origin API call returns 401 (i.e. the
 * session expired mid-session). Clerk's middleware already handles 401s on a
 * full navigation, but in-page fetches would otherwise just fail with no
 * recovery. Patches window.fetch while mounted and only acts on same-origin
 * /api 401s, leaving every other request (including Clerk's cross-origin token
 * refresh) untouched.
 */
export default function SessionExpiryGuard() {
  useEffect(() => {
    const originalFetch = window.fetch;
    let redirecting = false;

    const patchedFetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const response = await originalFetch(...args);
      if (response.status === 401 && !redirecting) {
        try {
          const input = args[0];
          if (input) {
            const rawUrl =
              typeof input === "string" || input instanceof URL ? input.toString() : input.url;
            const url = new URL(rawUrl, window.location.origin);
            if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
              redirecting = true;
              window.location.href = "/sign-in";
            }
          }
        } catch {
          // Never let URL parsing get in the way of returning the response.
        }
      }
      return response;
    };

    window.fetch = patchedFetch;

    return () => {
      // Only restore if nothing else wrapped fetch on top of ours, so we don't
      // clobber another library's (e.g. Sentry) wrapper.
      if (window.fetch === patchedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, []);

  return null;
}
