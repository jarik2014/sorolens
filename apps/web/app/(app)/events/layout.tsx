import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Events",
  description:
    "Browse indexed Soroban contract events — filter by contract, event type and date range, or follow the live SSE stream at /events/live.",
  openGraph: {
    title: "Events — Sorolens",
    description: "Indexed Soroban contract events, with a live SSE stream at /events/live.",
  },
  alternates: {
    canonical: "/events",
  },
};

export default function EventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
