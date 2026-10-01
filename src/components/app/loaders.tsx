"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "./SignInGate";

/**
 * These screens read browser-only state (the session, the wallet), so they
 * render on the client only — no hydration mismatch, no flash of an empty
 * state before the data is known.
 */
export const SetupLoader = dynamic(() => import("./Setup"), { ssr: false, loading: Skeleton });
export const DashboardLoader = dynamic(() => import("./Dashboard"), { ssr: false, loading: Skeleton });
