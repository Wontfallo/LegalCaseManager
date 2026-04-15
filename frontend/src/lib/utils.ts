/**
 * Utility functions for the frontend.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow, parseISO } from "date-fns";

/**
 * Merge Tailwind classes with clsx and tailwind-merge.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format an ISO date string for display.
 */
export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

/**
 * Format an ISO datetime string for display.
 */
export function formatDateTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return dateStr;
  }
}

/**
 * Relative time display (e.g., "2 hours ago").
 */
export function formatRelative(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

/**
 * Get status badge color.
 */
export function getStatusColor(
  status: string
): { bg: string; text: string; ring: string } {
  switch (status) {
    case "OPEN":
      return {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        ring: "ring-emerald-600/20",
      };
    case "IN_PROGRESS":
      return {
        bg: "bg-blue-50",
        text: "text-blue-700",
        ring: "ring-blue-600/20",
      };
    case "PENDING_REVIEW":
      return {
        bg: "bg-amber-50",
        text: "text-amber-700",
        ring: "ring-amber-600/20",
      };
    case "CLOSED":
      return {
        bg: "bg-slate-50",
        text: "text-slate-700",
        ring: "ring-slate-600/20",
      };
    case "ARCHIVED":
      return {
        bg: "bg-slate-100",
        text: "text-slate-500",
        ring: "ring-slate-400/20",
      };
    default:
      return {
        bg: "bg-gray-50",
        text: "text-gray-700",
        ring: "ring-gray-600/20",
      };
  }
}

/**
 * Confidence score to color.
 */
export function getConfidenceColor(score: number): string {
  if (score >= 0.8) return "text-emerald-600";
  if (score >= 0.5) return "text-amber-600";
  return "text-red-500";
}

/**
 * Truncate text with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Communication type icon label.
 */
export function getCommTypeLabel(type: string): string {
  switch (type) {
    case "EMAIL":
      return "Email";
    case "CALL":
      return "Phone Call";
    case "NOTE":
      return "Note";
    default:
      return type;
  }
}
