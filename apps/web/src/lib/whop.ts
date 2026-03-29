import Whop from "@whop/sdk";

let whopClient: Whop | null = null;

export function getWhopClient(): Whop {
  if (!whopClient) {
    if (!process.env.WHOP_API_KEY) {
      throw new Error("WHOP_API_KEY environment variable is not set");
    }
    whopClient = new Whop({
      apiKey: process.env.WHOP_API_KEY,
    });
  }
  return whopClient;
}
