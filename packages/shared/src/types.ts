import type { Decimal } from "@prisma/client/runtime/library";

// ============================================
// Shared type definitions for CompeteHive
// ============================================

// --- Tracked Products ---

export interface TrackedProductRow {
  id: string;
  user_id: string;
  product_name: string;
  marketplace: string;
  product_url: string;
  product_image: string | null;
  seller_name: string | null;
  current_price: Decimal | null;
  currency: string;
  status: string;
  last_scraped_at: Date | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface CompetitorRow {
  id: string;
  tracked_product_id: string;
  competitor_url: string;
  competitor_name: string | null;
  marketplace: string;
  current_price: Decimal | null;
  last_scraped_at: Date | null;
  created_at: Date;
  // Joined fields
  latest_price?: Decimal | null;
  // Client-enriched fields
  link?: string;
  retailerDomain?: string;
  retailerName?: string;
  retailerColor?: string;
}

export interface ProductWithCompetitors extends TrackedProductRow {
  competitors: CompetitorRow[];
}

// --- Alerts ---

export interface AlertRuleRow {
  id: string;
  user_id: string;
  tracked_product_id: string | null;
  rule_type: string;
  threshold_value: Decimal | null;
  direction: string | null;
  notify_via: string[];
  is_active: boolean;
  cooldown_minutes: number;
  last_triggered: Date | null;
  created_at: Date;
  // Joined fields
  product_name?: string;
  marketplace?: string;
}

// --- Notifications ---

export interface NotificationRow {
  id: string;
  user_id: string;
  alert_rule_id: string | null;
  channel: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  sent_at: Date;
  // Joined fields
  rule_type?: string;
  product_name?: string;
  marketplace?: string;
}

// --- Worker Alert Types ---

export interface AlertUser {
  id: string;
  email: string;
  telegramChatId: string | null;
  webhookUrl: string | null;
}

export interface AlertRuleWithUser {
  id: string;
  notifyVia: string[];
  user: AlertUser;
  trackedProduct: {
    productName: string;
    marketplace: string;
    productUrl: string;
  } | null;
}

// --- Compare Results ---

export interface CompareCompetitorResult {
  marketplace: string;
  name: string;
  price: number;
  url: string;
  link: string;
  retailerDomain: string;
  retailerName: string;
  retailerColor: string;
}
