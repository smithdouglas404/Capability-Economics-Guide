import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Legacy route — the insurance case study is now served by the generic
 * `/case-study/:slug` page so every industry uses the same polished layout.
 * Redirect preserves old bookmarks and outbound links without duplicating
 * the UI.
 */
export default function InsuranceExample() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/case-study/insurance", { replace: true });
  }, [setLocation]);
  return null;
}
