"use client";

import RouteError from "@/components/layout/route-error";

export default function StudentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError reset={reset} destination="/portal" destinationLabel="Ir a mi portal" />;
}
