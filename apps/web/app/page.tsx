/**
 * Root route — Conversation Surface (spec §6.1, the primary surface).
 *
 * Per NEXUS_PORTFOLIO_RUNTIME_SPEC.md the conversation surface is where the
 * portfolio company's agent operates: perception state + ongoing work + the
 * window the user nudges through. Direct CRUD pages live at /direct (fallback
 * per spec §6.5).
 *
 * The agent runtime sits at services/portfolio-runtime/ — this page is a
 * client to it via packages/runtime-client/.
 */

import { ConversationSurface } from "@/components/conversation/surface";

export default function HomePage(): JSX.Element {
  const companyName = process.env.COMPANY_NAME || "Portfolio Company";
  return <ConversationSurface companyName={companyName} />;
}
