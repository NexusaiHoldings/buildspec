/**
 * home-config (company-root-landing-001 backport). Do NOT hand-edit.
 */
export interface HomeCta { label: string; href: string; }
export interface HomeConfig {
  mode: "landing" | "conversation";
  headline?: string;
  subhead?: string;
  primaryCta?: HomeCta;
  secondaryCta?: HomeCta;
}

export const homeConfig: HomeConfig = {
  "mode": "landing",
  "headline": "Write Your Next Spec Package in 2 Hours, Not 40 \u2014 Without Hiring a Spec Writer",
  "subhead": "SpecDraft AI generates CSI MasterFormat-compliant project specifications and RFI response drafts from uploaded construction documents in under two hours \u2014 replacing a 15-40 hour manual writing task that mid-size GCs and MEP subs cannot staf"
};
