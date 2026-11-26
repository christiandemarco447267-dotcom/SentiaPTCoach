"use client";

import { useEffect, useState } from "react";
import { apiConfigured, subscribeApiLink } from "./api-config";

/** Re-renders when the built-in sentiacoach.com API answers /health. */
export function useApiConfigured(): boolean {
  const [on, setOn] = useState(apiConfigured);
  useEffect(() => subscribeApiLink(() => setOn(apiConfigured())), []);
  return on;
}
