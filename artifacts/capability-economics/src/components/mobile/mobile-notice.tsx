import { Monitor } from "lucide-react";

/**
 * Shown only on small screens (<640px). Signals to mobile users that the
 * page is dense and best on desktop, while leaving the underlying page
 * functional. Drop in at the top of any page that hasn't been mobile-tuned.
 */
export function MobileNotice({ message }: { message?: string }) {
  return (
    <div
      data-testid="mobile-notice"
      className="sm:hidden flex items-start gap-2 mx-4 mt-4 mb-2 p-3 border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300 text-xs leading-snug"
    >
      <Monitor className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        {message ??
          "This view is dense — best experienced on a larger screen. Core actions still work below."}
      </span>
    </div>
  );
}
