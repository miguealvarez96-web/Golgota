"use client";

import RouteError from "@/components/layout/route-error";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError reset={reset} destination="/" destinationLabel="Ir al Dashboard" />;
}
