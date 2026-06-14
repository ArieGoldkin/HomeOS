# WhatsApp Agent PoC — What We Need (2026)

> Date: 2026-06-12 · Lightweight research (direct source reads, synthesized)
> Question: what does a solo dev need to stand up a WhatsApp forward-and-parse agent in 2026?

## TL;DR (PM verdict)

**The channel is viable — with one hard condition.** The 2026 AI-chatbot policy we feared is
**real**, but it bans *general-purpose* assistants (ChatGPT-on-WhatsApp), not *single-purpose*
ones. HomeOS's forward-and-parse family organizer is single-purpose → **allowed**, as long as we
**never offer open-domain chat** and don't reuse message data beyond serving that user.

Start **free, direct on Meta's Cloud API, with the test number** (up to 5 family numbers). No
business verification, no BSP, no cost to get the first message flowing. Use the `mlx_whisper`
you already have for Hebrew voice notes (free). Total PoC cost ≈ **just hosting + Claude tokens,
well under $100/mo.**

---

## 1. The policy question (the one that could have killed it) — RESOLVED ✅⚠️

Earlier we flagged an Oct-2025 TechCrunch "chatbot ban" claim as *refuted/uncertain*. **Updated
finding: it is real and now confirmed.**

- **Effective Jan 15, 2026** (applies to new API users from Oct 15, 2025): Meta **prohibits
  general-purpose AI chatbots** on the WhatsApp Business Platform.
- **Prohibited** = LLM-powered, **open-domain** ("ask anything"), not tied to a specific business
  process — e.g. "ChatGPT or Perplexity on WhatsApp" (weather, write code, etc.). Also prohibited:
  sharing chat data **for AI model training**, or sending user messages to an AI provider **"for
  purposes beyond serving that user."**
- **Allowed** = **"structured, purpose-specific chatbots"** — customer support, bookings, order
  tracking, **notifications**, surveys, appointment management. AI is fine for "automating FAQs,
  routing, draft replies."

**Where HomeOS lands:** a bot that parses forwarded messages into calendar events/tasks and
answers questions about *your own family data* is **narrow, single-purpose → likely compliant.**

**Conditions to stay on the right side of the line:**
1. **No open-domain mode.** The bot must not become a general assistant ("what's the weather?").
   Keep it scoped to family scheduling/tasks.
2. **Use the user's data only to serve that user** — no training on chat content.
3. ⚠️ Meta's terms **don't explicitly address our exact case**, and there is now a separate
   **"pricing for AI providers"** page in Meta's docs — so **confirm with Meta or a BSP before
   *commercial* launch.** For the private family PoC, we're fine.

Sources: [TechCrunch (Oct 2025)](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/) · [Turn.io 2026 policy explainer](https://learn.turn.io/l/en/article/khmn56xu3a-whats-app-s-2026-ai-policy-explained) · [Alibaba Cloud policy guide](https://www.alibabacloud.com/help/en/chatapp/use-cases/whatsapp-ai-policy-2026-guide) · [Meta AI-provider pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers/) · [Meta Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms/)

## 2. Cloud API setup in 2026 — what's actually required first

To receive your **first inbound message**, you need:

| Asset | Note |
|---|---|
| Meta developer account | free, at developers.facebook.com |
| A **Business-type app** + **WhatsApp product** added | in the App Dashboard |
| **WhatsApp Business Account (WABA)** + Meta Business Manager | auto-created during setup |
| **Free test phone number** | **auto-generated**; message **up to 5 recipient numbers** you pre-add in the dashboard. No business verification needed |
| **Access token** | **temporary 24-hour token** for dev → **permanent system-user token** for anything lasting |
| **Webhook** | a **public HTTPS callback URL** + a **verify token** you choose; subscribe to the **`messages`** field to get inbound messages/media |

**Not required for the PoC:** business verification, display-name review, a real phone number —
those are only needed to **go live** (message arbitrary numbers at scale). The test number + 5
family recipients is exactly a dogfooding setup.

Sources: [Meta — Cloud API Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) · [Test number limits (WANotifier)](https://help.wanotifier.com/en/article/test-phone-number-limitations-in-direct-setup-kt0ly2/) · [respond.io Cloud API guide](https://respond.io/help/whatsapp/whatsapp-cloud-api)

## 3. Receiving & parsing

- **Inbound + forwarded messages** arrive as a webhook POST to your callback URL. Forwarded
  messages look like normal messages (text/media) with a forwarded flag — you read `messages[]`
  from the payload.
- **Media (voice notes, images):** the webhook gives a **media ID**; you make a second Graph API
  call to get a temporary URL, then download the file. Voice note → run through STT.
- **24-hour customer-service window:** when a user messages you, a 24h window opens in which you
  can reply **freely** (free-form, no template). Outside the window you must use an approved
  **template** message.
- **Pricing (per-message, effective July 1, 2025):** **service messages are free**; **utility
  messages within the 24h window are free**. Since our whole model is *user forwards → we reply
  within the window*, **replies are effectively free at family scale.** Proactive reminders
  outside the window would use paid templates — defer those past the PoC.

Source: confirmed in `market-research.md` (Meta pricing docs, 3-0 verified).

## 4. Build options & minimal stack

| Choice | Recommendation |
|---|---|
| **Direct Meta Cloud API vs BSP** (Twilio, 360dialog, respond.io) | **Direct Cloud API** for the PoC — free, no markup, no lock-in. BSPs add onboarding speed + a nicer API but charge a markup; only worth it later if verification/scale is painful |
| **Voice transcription (Hebrew)** | **Local `mlx_whisper` (whisper-large-v3)** — already installed, free, good Hebrew. (Cloud Whisper API ~$0.006/min is the fallback) |
| **LLM parse** | **Claude** via `@anthropic-ai/sdk`, structured outputs (Zod schema) → `{kind, title_he, date_iso, time, assignee, location, confidence}` |
| **Web stack** | **Hono or Express** (TypeScript) — one webhook route. Local dev via **cloudflared/ngrok tunnel** so Meta can reach `localhost`. Deploy later to Railway/Fly/Render (~$5/mo) |
| **Store** | SQLite (Drizzle) — fine for one family |

## 5. Costs & gotchas

**Monthly cost at family scale:** hosting ~$0–5 · WhatsApp ~$0 (user-initiated replies free) ·
Claude a few $ · Whisper $0 (local) → **comfortably under $100/mo.**

**Common first-timer blockers:**
- Webhook verification handshake (must echo `hub.challenge` on the GET verify request)
- Forgetting to **add recipient numbers** to the test-number allowlist (messages silently don't arrive)
- Public HTTPS required — `localhost` won't work without a tunnel
- Temporary token expires in 24h — annoying in dev; create a system-user token early
- Media needs the **second fetch** (ID → URL → download), easy to miss

**Unknowns to resolve before *commercial* launch (not before the PoC):**
- Exact applicability of the AI-provider pricing/policy to our single-purpose bot — confirm with Meta/BSP
- Business verification timeline for a real number
- Proactive-reminder template approval (only when we add outbound reminders)
