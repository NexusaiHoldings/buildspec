/**
 * CookieBanner — bottom-fixed banner shown when no current consent exists.
 * Three buttons: Accept All, Reject All, Customize.
 * Customize opens a panel with category toggles (v1: simple JSON object).
 * Persists via POST /api/legal/cookies/consent.
 */
"use client";
import React, { useState, useEffect } from "react";

interface CookieBannerProps {
  anonymousId?: string;
  onConsented?: (decision: string) => void;
}

const DEFAULT_CATEGORIES = {
  essential: true,
  analytics: false,
  marketing: false,
};

export function CookieBanner({ anonymousId, onConsented }: CookieBannerProps) {
  const [visible, setVisible] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Check if consent already on file
    fetch("/api/legal/cookies/consent/current", {
      headers: anonymousId ? { "X-Anonymous-Id": anonymousId } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.consent) setVisible(true);
      })
      .catch(() => setVisible(true)); // Show on error — safer than assuming consent
  }, [anonymousId]);

  const persist = async (decision: string, cats?: typeof categories) => {
    setSaving(true);
    try {
      await fetch("/api/legal/cookies/consent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(anonymousId ? { "X-Anonymous-Id": anonymousId } : {}),
        },
        body: JSON.stringify({
          decision,
          categories: cats ?? (decision === "accepted_all" ? { essential: true, analytics: true, marketing: true } : { essential: true }),
          anonymous_id: anonymousId,
        }),
      });
      setVisible(false);
      onConsented?.(decision);
    } catch {
      /* Non-blocking — user experience degrades silently */
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="cookie-banner fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-5xl mx-auto px-4 py-4">
        {!showCustomize ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <p className="flex-1 text-sm text-gray-700">
              We use cookies to improve your experience. Essential cookies are always active.
              You can choose whether to allow analytics and marketing cookies.
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setShowCustomize(true)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                disabled={saving}
              >
                Customize
              </button>
              <button
                onClick={() => persist("rejected_all")}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                disabled={saving}
              >
                Reject All
              </button>
              <button
                onClick={() => persist("accepted_all")}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                disabled={saving}
              >
                Accept All
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-800">Customize cookie preferences</p>
            {(Object.keys(DEFAULT_CATEGORIES) as Array<keyof typeof DEFAULT_CATEGORIES>).map((cat) => (
              <label key={cat} className="flex items-center gap-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={cat === "essential" ? true : categories[cat]}
                  disabled={cat === "essential"}
                  onChange={(e) =>
                    setCategories((prev) => ({ ...prev, [cat]: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <span className="capitalize">{cat}</span>
                {cat === "essential" && (
                  <span className="text-xs text-gray-400">(always active)</span>
                )}
              </label>
            ))}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowCustomize(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                disabled={saving}
              >
                Back
              </button>
              <button
                onClick={() => persist("custom", categories)}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                disabled={saving}
              >
                Save preferences
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
